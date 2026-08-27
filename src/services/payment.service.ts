
import crypto from "crypto";
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
} from "@prisma/client";

import { prisma } from "../config/prisma";
import { razorpay } from "../config/razorpay";
import { env } from "../config/env";

function toPaise(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("INVALID_PAYMENT_AMOUNT");
  }

  return Math.round(amount * 100);
}

function toNumber(value: Prisma.Decimal | number): number {
  return Number(value);
}

/**
 * Create or reuse a Razorpay order for an existing
 * SureBuy order.
 */
export async function createRazorpayOrder(
  userId: string,
  orderId: string,
) {
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      userId,
    },
    select: {
      id: true,
      orderNumber: true,
      totalAmount: true,
      currency: true,
      paymentStatus: true,
      paymentMethod: true,
    },
  });

  if (!order) {
    throw new Error("ORDER_NOT_FOUND");
  }

  if (order.paymentStatus === PaymentStatus.PAID) {
    throw new Error("ORDER_ALREADY_PAID");
  }

  if (order.paymentMethod === PaymentMethod.COD) {
    throw new Error("COD_ORDER_CANNOT_USE_RAZORPAY");
  }

  const existingPayment =
    await prisma.payment.findFirst({
      where: {
        orderId: order.id,
        provider: "RAZORPAY",
        status: {
          in: [
            PaymentStatus.PENDING,
            PaymentStatus.AUTHORIZED,
          ],
        },
        providerOrderId: {
          not: null,
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        providerOrderId: true,
        amount: true,
        currency: true,
      },
    });

  if (existingPayment?.providerOrderId) {
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      razorpayOrderId:
        existingPayment.providerOrderId,
      amount: toNumber(existingPayment.amount),
      amountInPaise: toPaise(
        toNumber(existingPayment.amount),
      ),
      currency: existingPayment.currency,
      keyId: env.RAZORPAY_KEY_ID,
    };
  }

  const amount = toNumber(order.totalAmount);

  const razorpayOrder =
    await razorpay.orders.create({
      amount: toPaise(amount),
      currency: order.currency,
      receipt: order.orderNumber,
      notes: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        userId,
      },
    });

  await prisma.payment.create({
    data: {
      orderId: order.id,
      provider: "RAZORPAY",
      providerOrderId: razorpayOrder.id,
      amount,
      currency: order.currency,
      status: PaymentStatus.PENDING,
      method: order.paymentMethod,
    },
  });

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    razorpayOrderId: razorpayOrder.id,
    amount,
    amountInPaise: razorpayOrder.amount,
    currency: razorpayOrder.currency,
    keyId: env.RAZORPAY_KEY_ID,
  };
}

/**
 * Verify the signature returned by Razorpay Checkout.
 *
 * IMPORTANT:
 * The order ID used for verification must be the
 * Razorpay order ID that OUR SERVER created.
 */
export async function verifyRazorpayPayment(
  userId: string,
  orderId: string,
  razorpayPaymentId: string,
  razorpayOrderId: string,
  razorpaySignature: string,
) {
  if (
    !razorpayPaymentId ||
    !razorpayOrderId ||
    !razorpaySignature
  ) {
    throw new Error("INVALID_PAYMENT_RESPONSE");
  }

  /*
   * 1. Make sure the order belongs to the
   *    authenticated user.
   */
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      userId,
    },
    select: {
      id: true,
      totalAmount: true,
      currency: true,
      paymentStatus: true,
    },
  });

  if (!order) {
    throw new Error("ORDER_NOT_FOUND");
  }

  /*
   * 2. Find the payment record created by OUR backend.
   *
   * We never trust a Razorpay order ID supplied by the
   * frontend unless it already belongs to this order.
   */
  const payment = await prisma.payment.findFirst({
    where: {
      orderId: order.id,
      provider: "RAZORPAY",
      providerOrderId: razorpayOrderId,
    },
  });

  if (!payment) {
    throw new Error("PAYMENT_NOT_FOUND");
  }

  /*
   * 3. Idempotency.
   *
   * Razorpay/frontend retries must not create a second
   * successful payment state.
   */
  if (
    payment.providerPaymentId ===
      razorpayPaymentId &&
    payment.status === PaymentStatus.PAID
  ) {
    return {
      success: true,
      alreadyProcessed: true,
      orderId: order.id,
      paymentId: payment.id,
      razorpayPaymentId,
      status: PaymentStatus.PAID,
    };
  }

  /*
   * 4. Verify Razorpay Checkout signature.
   *
   * IMPORTANT:
   * This uses the Razorpay KEY SECRET on the server.
   * The secret must NEVER be exposed to the frontend.
   */
  const expectedSignature =
    crypto
      .createHmac(
        "sha256",
        env.RAZORPAY_KEY_SECRET,
      )
      .update(
        `${razorpayOrderId}|${razorpayPaymentId}`,
      )
      .digest("hex");

  const receivedBuffer =
    Buffer.from(razorpaySignature, "utf8");

  const expectedBuffer =
    Buffer.from(expectedSignature, "utf8");

  if (
    receivedBuffer.length !==
    expectedBuffer.length
  ) {
    throw new Error(
      "INVALID_PAYMENT_SIGNATURE",
    );
  }

  if (
    !crypto.timingSafeEqual(
      receivedBuffer,
      expectedBuffer,
    )
  ) {
    throw new Error(
      "INVALID_PAYMENT_SIGNATURE",
    );
  }

  /*
   * 5. Confirm the payment with Razorpay itself.
   *
   * Signature verification proves that the response
   * was generated using our Razorpay secret.
   *
   * Fetching the payment from Razorpay additionally
   * lets us verify:
   *   - payment belongs to our Razorpay order
   *   - amount matches our order
   *   - currency matches
   *   - payment is actually captured
   */
  let razorpayPayment;

  try {
    razorpayPayment =
      await razorpay.payments.fetch(
        razorpayPaymentId,
      );
  } catch (error) {
    console.error(
      "RAZORPAY PAYMENT FETCH ERROR:",
      error,
    );

    throw new Error(
      "PAYMENT_VERIFICATION_FAILED",
    );
  }

  if (
    razorpayPayment.order_id !==
    razorpayOrderId
  ) {
    throw new Error(
      "PAYMENT_ORDER_MISMATCH",
    );
  }

  const expectedAmountInPaise =
    toPaise(
      toNumber(order.totalAmount),
    );

  if (
    razorpayPayment.amount !==
    expectedAmountInPaise
  ) {
    throw new Error(
      "PAYMENT_AMOUNT_MISMATCH",
    );
  }

  if (
    razorpayPayment.currency !==
    order.currency
  ) {
    throw new Error(
      "PAYMENT_CURRENCY_MISMATCH",
    );
  }

  /*
   * Razorpay payment must be captured before we
   * consider the order successfully paid.
   */
  if (
    razorpayPayment.status !==
    "captured"
  ) {
    throw new Error(
      "PAYMENT_NOT_CAPTURED",
    );
  }

  /*
   * 6. Atomically update our database.
   */
  const updatedPayment =
    await prisma.$transaction(
      async (tx) => {
        const updated =
          await tx.payment.update({
            where: {
              id: payment.id,
            },

            data: {
              providerPaymentId:
                razorpayPaymentId,

              signature:
                razorpaySignature,

              status:
                PaymentStatus.PAID,
            },
          });

        await tx.order.update({
          where: {
            id: order.id,
          },

          data: {
            paymentStatus:
              PaymentStatus.PAID,

            status:
              OrderStatus.CONFIRMED,
          },
        });

        return updated;
      },
    );

  return {
    success: true,
    alreadyProcessed: false,

    orderId: order.id,

    paymentId:
      updatedPayment.id,

    razorpayPaymentId:
      updatedPayment.providerPaymentId,

    status:
      updatedPayment.status,
  };
}

