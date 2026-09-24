import crypto from "crypto";

import {
  PaymentMethod,
  PaymentStatus,
  OrderStatus,
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
 * ============================================================
 * REMOVE PURCHASED CART QUANTITY
 * ============================================================
 *
 * Cart quantity is NOT inventory.
 *
 * This is executed only after successful payment processing.
 */

async function removePurchasedCartItems(
  tx: Prisma.TransactionClient,
  userId: string,
  orderId: string,
) {
  const cart = await tx.cart.findUnique({
    where: {
      userId,
    },
    select: {
      id: true,
    },
  });

  if (!cart) {
    return;
  }

  const orderItems = await tx.orderItem.findMany({
    where: {
      orderId,
    },
    select: {
      productId: true,
      variantId: true,
      quantity: true,
    },
  });

  for (const orderItem of orderItems) {
    const cartItem = await tx.cartItem.findFirst({
      where: {
        cartId: cart.id,
        productId: orderItem.productId,
        variantId: orderItem.variantId,
      },
      select: {
        id: true,
        quantity: true,
      },
    });

    if (!cartItem) {
      continue;
    }

    const remaining =
      cartItem.quantity - orderItem.quantity;

    if (remaining > 0) {
      await tx.cartItem.update({
        where: {
          id: cartItem.id,
        },
        data: {
          quantity: remaining,
        },
      });
    } else {
      await tx.cartItem.delete({
        where: {
          id: cartItem.id,
        },
      });
    }
  }
}

/**
 * ============================================================
 * DEDUCT STOCK AFTER SUCCESSFUL PAYMENT
 * ============================================================
 *
 * IMPORTANT:
 *
 * This is the ONLY function in the purchase flow that
 * decreases inventory.
 *
 * Stock is NOT deducted:
 *
 * - Add to cart
 * - Update cart
 * - Create order
 * - Create Razorpay order
 * - Payment authorized
 * - Payment failed
 * - Payment cancelled
 *
 * Stock is deducted ONLY when payment is captured.
 */

async function deductStockAfterSuccessfulPayment(
  tx: Prisma.TransactionClient,
  orderId: string,
) {
  const order = await tx.order.findUnique({
    where: {
      id: orderId,
    },
    select: {
      id: true,
      stockReserved: true,
    },
  });

  if (!order) {
    throw new Error("ORDER_NOT_FOUND");
  }

  /**
   * Idempotency protection.
   *
   * Prevents duplicate stock deduction when:
   *
   * - frontend verification runs
   * - webhook runs
   * - webhook is retried
   */
  if (order.stockReserved) {
    return;
  }

  const items = await tx.orderItem.findMany({
    where: {
      orderId,
    },
    select: {
      productId: true,
      variantId: true,
      quantity: true,
    },
  });

  if (items.length === 0) {
    throw new Error("ORDER_HAS_NO_ITEMS");
  }

  /**
   * First validate every item.
   *
   * Nothing is changed during this validation phase.
   */
  for (const item of items) {
    if (item.variantId === null) {
      throw new Error("VARIANT_REQUIRED");
    }

    const variant = await tx.productVariant.findFirst({
      where: {
        id: item.variantId,
        productId: item.productId,
      },
      select: {
        id: true,
        stock: true,
      },
    });

    if (!variant) {
      throw new Error("VARIANT_NOT_FOUND");
    }

    if (variant.stock < item.quantity) {
      throw new Error("INSUFFICIENT_STOCK_AFTER_PAYMENT");
    }
  }

  /**
   * Now perform atomic deductions.
   *
   * The stock >= quantity condition protects against
   * concurrent purchases.
   */
  for (const item of items) {
    const result = await tx.productVariant.updateMany({
      where: {
        id: item.variantId!,
        productId: item.productId,
        stock: {
          gte: item.quantity,
        },
      },
      data: {
        stock: {
          decrement: item.quantity,
        },
      },
    });

    if (result.count !== 1) {
      throw new Error(
        "INSUFFICIENT_STOCK_AFTER_PAYMENT",
      );
    }
  }

  /**
   * Mark inventory as consumed.
   *
   * Same transaction.
   */
  await tx.order.update({
    where: {
      id: orderId,
    },
    data: {
      stockReserved: true,
    },
  });
}

/**
 * ============================================================
 * PROCESS CAPTURED PAYMENT
 * ============================================================
 *
 * This is the single source of truth for successful payment.
 *
 * Called by:
 *
 * 1. Frontend Razorpay verification
 * 2. Razorpay payment.captured webhook
 */

export async function processCapturedPayment(
  providerOrderId: string,
  providerPaymentId: string,
) {
  return prisma.$transaction(
    async (tx) => {
      const payment = await tx.payment.findUnique({
        where: {
          providerOrderId,
        },
        include: {
          order: {
            select: {
              id: true,
              userId: true,
              orderNumber: true,
              currency: true,
              totalAmount: true,
              paymentStatus: true,
              status: true,
              stockReserved: true,
              paymentMethod: true,
            },
          },
        },
      });

      if (!payment) {
        throw new Error("PAYMENT_NOT_FOUND");
      }

      /**
       * Already processed.
       */
      if (
        payment.status === PaymentStatus.PAID &&
        payment.providerPaymentId === providerPaymentId
      ) {
        return {
          success: true,
          alreadyProcessed: true,
          orderId: payment.orderId,
          orderNumber: payment.order.orderNumber,
          paymentId: payment.id,
          razorpayPaymentId: providerPaymentId,
          status: PaymentStatus.PAID,
        };
      }

      /**
       * Order already paid.
       */
      if (
        payment.order.paymentStatus ===
        PaymentStatus.PAID
      ) {
        return {
          success: true,
          alreadyProcessed: true,
          orderId: payment.orderId,
          orderNumber: payment.order.orderNumber,
          paymentId: payment.id,
          razorpayPaymentId: providerPaymentId,
          status: PaymentStatus.PAID,
        };
      }

      /**
       * ======================================================
       * STOCK DEDUCTION
       * ======================================================
       *
       * This is the ONLY point where inventory changes.
       */
      await deductStockAfterSuccessfulPayment(
        tx,
        payment.orderId,
      );

      /**
       * Mark payment as PAID.
       */
      const updatedPayment =
        await tx.payment.update({
          where: {
            id: payment.id,
          },
          data: {
            providerPaymentId:
              providerPaymentId,
            status: PaymentStatus.PAID,
          },
        });

      /**
       * Mark order as confirmed.
       */
      await tx.order.update({
        where: {
          id: payment.orderId,
        },
        data: {
          paymentStatus:
            PaymentStatus.PAID,
          status:
            OrderStatus.CONFIRMED,
        },
      });

      /**
       * Remove purchased quantity from cart.
       */
      await removePurchasedCartItems(
        tx,
        payment.order.userId,
        payment.orderId,
      );

      return {
        success: true,
        alreadyProcessed: false,
        orderId: payment.orderId,
        orderNumber: payment.order.orderNumber,
        paymentId: updatedPayment.id,
        razorpayPaymentId: providerPaymentId,
        status: PaymentStatus.PAID,
      };
    },
    {
      isolationLevel:
        Prisma.TransactionIsolationLevel.Serializable,

      timeout: 15000,
    },
  );
}

/**
 * ============================================================
 * CREATE RAZORPAY ORDER
 * ============================================================
 *
 * NEVER changes inventory.
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
      status: true,
    },
  });

  if (!order) {
    throw new Error("ORDER_NOT_FOUND");
  }

  if (
    order.paymentStatus ===
    PaymentStatus.PAID
  ) {
    throw new Error("ORDER_ALREADY_PAID");
  }

  if (
    order.status ===
    OrderStatus.CANCELLED
  ) {
    throw new Error("ORDER_CANCELLED");
  }

  /**
   * Reuse latest pending/authorized payment.
   *
   * No stock mutation.
   */
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
      amount: toNumber(
        existingPayment.amount,
      ),
      amountInPaise: toPaise(
        toNumber(
          existingPayment.amount,
        ),
      ),
      currency: existingPayment.currency,
      keyId: env.RAZORPAY_KEY_ID,
    };
  }

  /**
   * COD = ₹500 advance.
   *
   * UPI/Card/EMI = complete order amount.
   */
  const amount =
    order.paymentMethod === PaymentMethod.COD
      ? 500
      : toNumber(order.totalAmount);

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    throw new Error(
      "INVALID_PAYMENT_AMOUNT",
    );
  }

  let razorpayOrder;

  try {
    razorpayOrder =
      await razorpay.orders.create({
        amount: toPaise(amount),
        currency: order.currency,
        receipt: order.orderNumber,
        notes: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          userId,
          paymentMethod:
            order.paymentMethod,
        },
      });
  } catch (error) {
    console.error(
      "RAZORPAY ORDER CREATION ERROR:",
      error,
    );

    throw error;
  }

  /**
   * Save payment attempt.
   *
   * Still NO inventory mutation.
   */
  await prisma.payment.create({
    data: {
      orderId: order.id,
      provider: "RAZORPAY",
      providerOrderId:
        razorpayOrder.id,
      amount,
      currency: order.currency,
      status: PaymentStatus.PENDING,
      method: order.paymentMethod,
    },
  });

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    razorpayOrderId:
      razorpayOrder.id,
    amount,
    amountInPaise:
      razorpayOrder.amount,
    currency:
      razorpayOrder.currency,
    keyId:
      env.RAZORPAY_KEY_ID,
  };
}

/**
 * ============================================================
 * VERIFY RAZORPAY PAYMENT
 * ============================================================
 *
 * Browser data is not trusted.
 *
 * We verify:
 *
 * 1. Checkout signature
 * 2. Razorpay payment
 * 3. Razorpay order
 * 4. Amount
 * 5. Currency
 * 6. Payment status
 *
 * Inventory is consumed ONLY for captured payment.
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
    throw new Error(
      "INVALID_PAYMENT_RESPONSE",
    );
  }

  const order =
    await prisma.order.findFirst({
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

  const payment =
    await prisma.payment.findFirst({
      where: {
        orderId: order.id,
        provider: "RAZORPAY",
        providerOrderId:
          razorpayOrderId,
      },
    });

  if (!payment) {
    throw new Error("PAYMENT_NOT_FOUND");
  }

  if (
    payment.currency !==
    order.currency
  ) {
    throw new Error(
      "PAYMENT_CURRENCY_MISMATCH",
    );
  }

  /**
   * Expected amount comes from our DB,
   * not from the browser.
   */
  const expectedAmountInPaise =
    toPaise(
      toNumber(payment.amount),
    );

  /**
   * Verify Razorpay checkout signature.
   */
  const expectedSignature =
    crypto
      .createHmac(
        "sha256",
        env.RAZORPAY_KEY_SECRET,
      )
      .update(
        `${payment.providerOrderId}|${razorpayPaymentId}`,
      )
      .digest("hex");

  const receivedBuffer =
    Buffer.from(
      razorpaySignature,
      "utf8",
    );

  const expectedBuffer =
    Buffer.from(
      expectedSignature,
      "utf8",
    );

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

  /**
   * Fetch authoritative payment from Razorpay.
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

  /**
   * Verify Razorpay order.
   */
  if (
    razorpayPayment.order_id !==
    payment.providerOrderId
  ) {
    throw new Error(
      "PAYMENT_ORDER_MISMATCH",
    );
  }

  /**
   * Verify amount.
   */
  if (
    razorpayPayment.amount !==
    expectedAmountInPaise
  ) {
    throw new Error(
      "PAYMENT_AMOUNT_MISMATCH",
    );
  }

  /**
   * Verify currency.
   */
  if (
    razorpayPayment.currency !==
    order.currency
  ) {
    throw new Error(
      "PAYMENT_CURRENCY_MISMATCH",
    );
  }

  /**
   * ONLY CAPTURED PAYMENT CAN DEDUCT STOCK.
   */
  if (
    razorpayPayment.status !==
    "captured"
  ) {
    if (
      razorpayPayment.status ===
      "authorized"
    ) {
      throw new Error(
        "PAYMENT_NOT_CAPTURED",
      );
    }

    throw new Error(
      "PAYMENT_VERIFICATION_FAILED",
    );
  }

  /**
   * Store provider payment ID/signature.
   */
  await prisma.payment.update({
    where: {
      id: payment.id,
    },
    data: {
      providerPaymentId:
        razorpayPaymentId,
      signature:
        razorpaySignature,
    },
  });

  /**
   * This performs the ONLY stock deduction.
   */
  return processCapturedPayment(
    payment.providerOrderId!,
    razorpayPaymentId,
  );
}