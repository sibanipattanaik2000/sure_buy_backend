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
 * Create or reuse a Razorpay order for an existing
 * SureBuy order.
 */

export async function createRazorpayOrder(userId: string, orderId: string) {
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

  const existingPayment = await prisma.payment.findFirst({
    where: {
      orderId: order.id,
      provider: "RAZORPAY",
      status: {
        in: [PaymentStatus.PENDING, PaymentStatus.AUTHORIZED],
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
      razorpayOrderId: existingPayment.providerOrderId,
      amount: toNumber(existingPayment.amount),
      amountInPaise: toPaise(toNumber(existingPayment.amount)),
      currency: existingPayment.currency,
      keyId: env.RAZORPAY_KEY_ID,
    };
  }

  const amount =
    order.paymentMethod === PaymentMethod.COD
      ? 500
      : toNumber(order.totalAmount);

  /*
   * Tracks whether THIS request reserved stock for a retry.
   *
   * This is important because the catch block must only
   * release stock if this exact request reserved it.
   */
  let stockReservedForRetry = false;

  /*
   * ONLINE PAYMENT RETRY
   *
   * If the previous Razorpay payment failed, the
   * payment.failed webhook already released the stock.
   *
   * Reserve the stock again before creating a new
   * Razorpay payment order.
   *
   * COD is excluded because COD stock was already
   * reserved when the order was created.
   */
  if (order.paymentMethod !== PaymentMethod.COD) {
    const failedPayment = await prisma.payment.findFirst({
      where: {
        orderId: order.id,
        provider: "RAZORPAY",
        status: PaymentStatus.FAILED,
      },
      select: {
        id: true,
      },
    });

    if (failedPayment) {
      const orderItems = await prisma.orderItem.findMany({
        where: {
          orderId: order.id,
        },
        select: {
          productId: true,
          variantId: true,
          quantity: true,
        },
      });

 await prisma.$transaction(
  async (tx) => {
    const currentOrder = await tx.order.findUnique({
      where: {
        id: order.id,
      },
      select: {
        stockReserved: true,
      },
    });

    if (!currentOrder) {
      throw new Error("ORDER_NOT_FOUND");
    }

    /*
     * Another retry request may have already reserved
     * the stock.
     */
    if (currentOrder.stockReserved) {
      return;
    }

    for (const item of orderItems) {
      if (item.variantId === null) {
        continue;
      }

      const updatedVariant = await tx.productVariant.updateMany({
        where: {
          id: item.variantId,
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

      if (updatedVariant.count !== 1) {
        throw new Error("INSUFFICIENT_STOCK");
      }
    }

    await tx.order.update({
      where: {
        id: order.id,
      },
      data: {
        stockReserved: true,
      },
    });
  },
  {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  },
);

stockReservedForRetry = true;
      /*
       * Mark the reservation only after the transaction
       * has successfully committed.
       */
      stockReservedForRetry = true;
    }
  }

  /*
   * Create the Razorpay payment order.
   *
   * If Razorpay fails after THIS request reserved stock,
   * release that reservation.
   */
  let razorpayOrder;

  try {
    razorpayOrder = await razorpay.orders.create({
      amount: toPaise(amount),
      currency: order.currency,
      receipt: order.orderNumber,
      notes: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        userId,
      },
    });
  } catch (error) {
    /*
     * Only release stock when this exact request
     * performed the retry reservation.
     */
    if (stockReservedForRetry) {
      const orderItems = await prisma.orderItem.findMany({
        where: {
          orderId: order.id,
        },
        select: {
          variantId: true,
          quantity: true,
        },
      });

      await prisma.$transaction(
        async (tx) => {
          for (const item of orderItems) {
            if (item.variantId === null) {
              continue;
            }

            await tx.productVariant.update({
              where: {
                id: item.variantId,
              },
              data: {
                stock: {
                  increment: item.quantity,
                },
              },
            });
          }
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );
    }

    console.error("RAZORPAY ORDER CREATION ERROR:", error);

    throw error;
  }

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
  if (!razorpayPaymentId || !razorpayOrderId || !razorpaySignature) {
    throw new Error("INVALID_PAYMENT_RESPONSE");
  }

  /*
   * =========================================================
   * 1. Find OUR order
   * =========================================================
   */

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
    },
  });

  if (!order) {
    throw new Error("ORDER_NOT_FOUND");
  }

  /*
   * =========================================================
   * 2. Find OUR Razorpay payment record
   * =========================================================
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
   * =========================================================
   * 3. Make sure the payment belongs to this order
   * =========================================================
   */

  if (payment.orderId !== order.id) {
    throw new Error("PAYMENT_ORDER_MISMATCH");
  }

  /*
   * =========================================================
   * 4. Validate amount
   * =========================================================
   */
  const expectedAmountInPaise = toPaise(toNumber(payment.amount));

  if (!Number.isFinite(expectedAmountInPaise) || expectedAmountInPaise <= 0) {
    throw new Error("PAYMENT_AMOUNT_MISMATCH");
  }
  /*
   * =========================================================
   * 5. Validate currency
   * =========================================================
   */

  if (payment.currency !== order.currency) {
    throw new Error("PAYMENT_CURRENCY_MISMATCH");
  }

  /*
   * =========================================================
   * 6. Idempotency
   * =========================================================
   *
   * If the same successful payment is submitted twice,
   * return the already processed result instead of
   * creating another state transition.
   */

  if (
    payment.providerPaymentId === razorpayPaymentId &&
    payment.status === PaymentStatus.PAID
  ) {
    return {
      success: true,
      alreadyProcessed: true,
      orderId: order.id,
      orderNumber: order.orderNumber,
      paymentId: payment.id,
      razorpayPaymentId,
      status: PaymentStatus.PAID,
    };
  }

  /*
   * =========================================================
   * 7. Verify Razorpay Checkout signature
   * =========================================================
   *
   * IMPORTANT:
   *
   * The order ID used here is the Razorpay order ID that
   * OUR DATABASE created.
   *
   * Razorpay recommends server-side signature verification.
   */

  const expectedSignature = crypto
    .createHmac("sha256", env.RAZORPAY_KEY_SECRET)
    .update(`${payment.providerOrderId}|${razorpayPaymentId}`)
    .digest("hex");

  const receivedBuffer = Buffer.from(razorpaySignature);

  const expectedBuffer = Buffer.from(expectedSignature);

  if (receivedBuffer.length !== expectedBuffer.length) {
    throw new Error("INVALID_PAYMENT_SIGNATURE");
  }

  if (!crypto.timingSafeEqual(receivedBuffer, expectedBuffer)) {
    throw new Error("INVALID_PAYMENT_SIGNATURE");
  }

  /*
   * =========================================================
   * 8. Ask Razorpay for the REAL payment status
   * =========================================================
   *
   * Never trust the browser to tell us that payment was
   * captured.
   */

  let razorpayPayment;

  try {
    razorpayPayment = await razorpay.payments.fetch(razorpayPaymentId);
  } catch (error) {
    console.error("RAZORPAY PAYMENT FETCH ERROR:", error);

    throw new Error("PAYMENT_VERIFICATION_FAILED");
  }

  /*
   * =========================================================
   * 9. Verify provider order ID
   * =========================================================
   */

  if (razorpayPayment.order_id !== payment.providerOrderId) {
    throw new Error("PAYMENT_ORDER_MISMATCH");
  }

  /*
   * =========================================================
   * 10. Verify provider amount
   * =========================================================
   */

  if (razorpayPayment.amount !== expectedAmountInPaise) {
    throw new Error("PAYMENT_AMOUNT_MISMATCH");
  }

  /*
   * =========================================================
   * 11. Verify provider currency
   * =========================================================
   */

  if (razorpayPayment.currency !== order.currency) {
    throw new Error("PAYMENT_CURRENCY_MISMATCH");
  }

  /*
   * =========================================================
   * 12. Payment MUST be captured
   * =========================================================
   *
   * Authorized != money successfully captured.
   *
   * Your Razorpay account should use automatic capture,
   * or the backend must explicitly capture authorized
   * payments.
   */

  if (razorpayPayment.status !== "captured") {
    if (razorpayPayment.status === "authorized") {
      throw new Error("PAYMENT_NOT_CAPTURED");
    }

    throw new Error("PAYMENT_VERIFICATION_FAILED");
  }

  /*
   * =========================================================
   * 13. Persist the verified payment atomically
   * =========================================================
   */

  const updatedPayment = await prisma.$transaction(async (tx) => {
    const currentPayment = await tx.payment.findUnique({
      where: {
        id: payment.id,
      },
    });

    if (!currentPayment) {
      throw new Error("PAYMENT_NOT_FOUND");
    }

    /*
     * Another request/webhook may have already
     * completed this payment.
     */
    if (currentPayment.status === PaymentStatus.PAID) {
      return currentPayment;
    }

    const updated = await tx.payment.update({
      where: {
        id: payment.id,
      },
      data: {
        providerPaymentId: razorpayPaymentId,

        signature: razorpaySignature,

        status: PaymentStatus.PAID,
      },
    });

    await tx.order.update({
      where: {
        id: order.id,
      },
      data: {
        paymentStatus:
          payment.method === PaymentMethod.COD
            ? PaymentStatus.PENDING
            : PaymentStatus.PAID,

        status: OrderStatus.CONFIRMED,
      },
    });
    /* =====================================================
   REMOVE ONLY PURCHASED ITEMS FROM CART
===================================================== */

    const cart = await tx.cart.findUnique({
      where: {
        userId,
      },
      select: {
        id: true,
      },
    });

    if (cart) {
      const orderItems = await tx.orderItem.findMany({
        where: {
          orderId: order.id,
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

        const remainingQuantity = cartItem.quantity - orderItem.quantity;

        if (remainingQuantity > 0) {
          await tx.cartItem.update({
            where: {
              id: cartItem.id,
            },
            data: {
              quantity: remainingQuantity,
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
    return updated;
  });

  return {
    success: true,
    alreadyProcessed:
      updatedPayment.status === PaymentStatus.PAID &&
      payment.status === PaymentStatus.PAID,

    orderId: order.id,
    orderNumber: order.orderNumber,

    paymentId: updatedPayment.id,

    razorpayPaymentId: updatedPayment.providerPaymentId,

    status: updatedPayment.status,
  };
}
