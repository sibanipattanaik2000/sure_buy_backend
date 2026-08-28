import crypto from "crypto";

import {
  PaymentMethod,
  PaymentStatus,
  SellRequestStatus,
  Prisma,
} from "@prisma/client";

import { prisma } from "../config/prisma";
import { razorpay } from "../config/razorpay";
import { env } from "../config/env";

const SELL_PICKUP_FEE = 500;
const SELL_CURRENCY = "INR";

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
 * Create or reuse the Razorpay order for a sell request.
 */
export async function createSellPaymentOrder(
  userId: string,
  sellRequestId: string,
  method: PaymentMethod,
) {
  const sellRequest = await prisma.sellRequest.findFirst({
    where: {
      id: sellRequestId,
      userId,
    },
    select: {
      id: true,
      userId: true,
      status: true,
      sellPayments: {
        orderBy: {
          createdAt: "desc",
        },
        take: 1,
        select: {
          id: true,
          providerOrderId: true,
          amount: true,
          currency: true,
          status: true,
          method: true,
        },
      },
    },
  });

  if (!sellRequest) {
    throw new Error("SELL_REQUEST_NOT_FOUND");
  }

  if (
    sellRequest.status === SellRequestStatus.CANCELLED ||
    sellRequest.status === SellRequestStatus.REJECTED
  ) {
    throw new Error("SELL_REQUEST_NOT_PAYABLE");
  }

  const latestPayment = sellRequest.sellPayments[0];

  /**
   * If this sell request was already successfully paid,
   * don't create another payment.
   */
  if (latestPayment?.status === PaymentStatus.PAID) {
    throw new Error("SELL_PAYMENT_ALREADY_PAID");
  }

  /**
   * Reuse an existing pending/authorized Razorpay order.
   */
  if (
    latestPayment?.providerOrderId &&
    (
      latestPayment.status === PaymentStatus.PENDING ||
      latestPayment.status === PaymentStatus.AUTHORIZED
    )
  ) {
    return {
      sellRequestId: sellRequest.id,
      sellPaymentId: latestPayment.id,
      razorpayOrderId: latestPayment.providerOrderId,
      amount: toNumber(latestPayment.amount),
      amountInPaise: toPaise(toNumber(latestPayment.amount)),
      currency: latestPayment.currency,
      keyId: env.RAZORPAY_KEY_ID,
      method: latestPayment.method,
    };
  }

  const amount = SELL_PICKUP_FEE;

  const razorpayOrder = await razorpay.orders.create({
    amount: toPaise(amount),
    currency: SELL_CURRENCY,
    receipt: `SELL-${sellRequest.id}`,
    notes: {
      sellRequestId: sellRequest.id,
      userId,
      purpose: "SELL_PICKUP_FEE",
    },
  });

  const sellPayment = await prisma.sellPayment.create({
    data: {
      sellRequestId: sellRequest.id,

      provider: "RAZORPAY",

      providerOrderId: razorpayOrder.id,

      amount,

      currency: SELL_CURRENCY,

      status: PaymentStatus.PENDING,

      method,
    },
  });

  return {
    sellRequestId: sellRequest.id,
    sellPaymentId: sellPayment.id,
    razorpayOrderId: razorpayOrder.id,
    amount,
    amountInPaise: razorpayOrder.amount,
    currency: razorpayOrder.currency,
    keyId: env.RAZORPAY_KEY_ID,
    method,
  };
}

/**
 * Verify a Razorpay sell-payment checkout response.
 */
export async function verifySellPayment(
  userId: string,
  sellRequestId: string,
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

  const sellRequest = await prisma.sellRequest.findFirst({
    where: {
      id: sellRequestId,
      userId,
    },
    select: {
      id: true,
      status: true,
    },
  });

  if (!sellRequest) {
    throw new Error("SELL_REQUEST_NOT_FOUND");
  }

  const sellPayment = await prisma.sellPayment.findFirst({
    where: {
      sellRequestId: sellRequest.id,
      provider: "RAZORPAY",
      providerOrderId: razorpayOrderId,
    },
  });

  if (!sellPayment) {
    throw new Error("SELL_PAYMENT_NOT_FOUND");
  }

  if (sellPayment.sellRequestId !== sellRequest.id) {
    throw new Error("PAYMENT_REQUEST_MISMATCH");
  }

  const expectedAmountInPaise = toPaise(
    toNumber(sellPayment.amount),
  );

  if (sellPayment.currency !== SELL_CURRENCY) {
    throw new Error("PAYMENT_CURRENCY_MISMATCH");
  }

  /**
   * Idempotency.
   */
  if (
    sellPayment.providerPaymentId === razorpayPaymentId &&
    sellPayment.status === PaymentStatus.PAID
  ) {
    return {
      success: true,
      alreadyProcessed: true,
      sellRequestId: sellRequest.id,
      sellPaymentId: sellPayment.id,
      razorpayPaymentId,
      status: PaymentStatus.PAID,
    };
  }

  /**
   * Verify Razorpay Checkout signature.
   */
  const expectedSignature = crypto
    .createHmac(
      "sha256",
      env.RAZORPAY_KEY_SECRET,
    )
    .update(
      `${sellPayment.providerOrderId}|${razorpayPaymentId}`,
    )
    .digest("hex");

  const receivedBuffer = Buffer.from(
    razorpaySignature,
  );

  const expectedBuffer = Buffer.from(
    expectedSignature,
  );

  if (
    receivedBuffer.length !==
    expectedBuffer.length
  ) {
    throw new Error("INVALID_PAYMENT_SIGNATURE");
  }

  if (
    !crypto.timingSafeEqual(
      receivedBuffer,
      expectedBuffer,
    )
  ) {
    throw new Error("INVALID_PAYMENT_SIGNATURE");
  }

  /**
   * Never trust the browser's payment status.
   * Ask Razorpay for the actual payment.
   */
  let razorpayPayment;

  try {
    razorpayPayment =
      await razorpay.payments.fetch(
        razorpayPaymentId,
      );
  } catch (error) {
    console.error(
      "SELL RAZORPAY PAYMENT FETCH ERROR:",
      error,
    );

    throw new Error(
      "PAYMENT_VERIFICATION_FAILED",
    );
  }

  if (
    razorpayPayment.order_id !==
    sellPayment.providerOrderId
  ) {
    throw new Error("PAYMENT_ORDER_MISMATCH");
  }

  if (
    razorpayPayment.amount !==
    expectedAmountInPaise
  ) {
    throw new Error("PAYMENT_AMOUNT_MISMATCH");
  }

  if (
    razorpayPayment.currency !==
    sellPayment.currency
  ) {
    throw new Error("PAYMENT_CURRENCY_MISMATCH");
  }

  /**
   * Payment must actually be captured.
   */
  if (razorpayPayment.status !== "captured") {
    if (
      razorpayPayment.status === "authorized"
    ) {
      throw new Error("PAYMENT_NOT_CAPTURED");
    }

    throw new Error(
      "PAYMENT_VERIFICATION_FAILED",
    );
  }

  /**
   * Atomically:
   *
   * SellPayment → PAID
   * SellRequest → PICKUP_SCHEDULED
   */
  const result = await prisma.$transaction(
    async (tx) => {
      const currentPayment =
        await tx.sellPayment.findUnique({
          where: {
            id: sellPayment.id,
          },
        });

      if (!currentPayment) {
        throw new Error(
          "SELL_PAYMENT_NOT_FOUND",
        );
      }

      /**
       * Another request/webhook may already
       * have completed this payment.
       */
      if (
        currentPayment.status ===
        PaymentStatus.PAID
      ) {
        return {
          payment: currentPayment,
          alreadyProcessed: true,
        };
      }

      const updatedPayment =
        await tx.sellPayment.update({
          where: {
            id: currentPayment.id,
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

      await tx.sellRequest.update({
        where: {
          id: sellRequest.id,
        },
        data: {
          status:
            SellRequestStatus.PICKUP_SCHEDULED,
        },
      });

      return {
        payment: updatedPayment,
        alreadyProcessed: false,
      };
    },
  );

  return {
    success: true,
    alreadyProcessed:
      result.alreadyProcessed,

    sellRequestId:
      sellRequest.id,

    sellPaymentId:
      result.payment.id,

    razorpayPaymentId:
      result.payment.providerPaymentId,

    status:
      result.payment.status,
  };
}

/**
 * Get the current sell payment state.
 *
 * Used by the success page after redirect.
 */
export async function getSellPaymentStatus(
  userId: string,
  sellRequestId: string,
) {
  const sellRequest =
    await prisma.sellRequest.findFirst({
      where: {
        id: sellRequestId,
        userId,
      },
      select: {
        id: true,
        status: true,
        estimatedValue: true,
        finalValue: true,
        pickupAddress: true,
        pickupDate: true,
        pickupSlot: true,

        product: {
          select: {
            id: true,
            name: true,
            brand: true,
            images: {
              orderBy: {
                position: "asc",
              },
              take: 1,
              select: {
                url: true,
              },
            },
          },
        },

        sellPayments: {
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
          select: {
            id: true,
            amount: true,
            currency: true,
            status: true,
            method: true,
            providerPaymentId: true,
            createdAt: true,
          },
        },
      },
    });

  if (!sellRequest) {
    throw new Error("SELL_REQUEST_NOT_FOUND");
  }

  const payment =
    sellRequest.sellPayments[0] ?? null;

  return {
    sellRequestId: sellRequest.id,

    sellRequestStatus:
      sellRequest.status,

    estimatedValue:
      Number(sellRequest.estimatedValue),

    finalValue:
      sellRequest.finalValue !== null
        ? Number(sellRequest.finalValue)
        : null,

    pickupAddress:
      sellRequest.pickupAddress,

    pickupDate:
      sellRequest.pickupDate,

    pickupSlot:
      sellRequest.pickupSlot,

    product: {
      id: sellRequest.product.id,
      name: sellRequest.product.name,
      brand: sellRequest.product.brand,
      image:
        sellRequest.product.images[0]?.url ??
        null,
    },

    payment: payment
      ? {
          id: payment.id,
          amount: Number(payment.amount),
          currency: payment.currency,
          status: payment.status,
          method: payment.method,
          razorpayPaymentId:
            payment.providerPaymentId,
          createdAt: payment.createdAt,
        }
      : null,
  };
}