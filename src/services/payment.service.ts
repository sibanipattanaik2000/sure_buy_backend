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

const RAZORPAY_PROVIDER = "RAZORPAY";
const COD_ADVANCE_AMOUNT = 500;

function toPaise(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("INVALID_PAYMENT_AMOUNT");
  }

  return Math.round(amount * 100);
}

function toNumber(value: Prisma.Decimal | number): number {
  return Number(value);
}

function safeString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0
    ? value
    : undefined;
}

/**
 * ============================================================
 * REMOVE PURCHASED CART QUANTITY
 * ============================================================
 *
 * Cart quantity is NOT inventory.
 *
 * Cart is modified only after successful payment processing.
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

    const remaining = cartItem.quantity - orderItem.quantity;

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
 * VALIDATE + DEDUCT STOCK
 * ============================================================
 *
 * This is the ONLY function in the purchase flow that
 * decreases inventory.
 *
 * It is called ONLY after Razorpay confirms CAPTURED.
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
   * Idempotency.
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
   * Every purchasable order must have a variant.
   */
  for (const item of items) {
    if (item.variantId === null) {
      throw new Error("VARIANT_REQUIRED");
    }

    if (item.quantity <= 0) {
      throw new Error("INVALID_ORDER_QUANTITY");
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
   * Atomic stock deductions.
   *
   * WHERE stock >= quantity prevents concurrent
   * purchases from making inventory negative.
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
      throw new Error("INSUFFICIENT_STOCK_AFTER_PAYMENT");
    }
  }

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
 * CREATE RAZORPAY REFUND
 * ============================================================
 *
 * Razorpay is an external system.
 *
 * Flow:
 *
 * 1. Payment is marked REFUND_PENDING inside the transaction.
 * 2. Razorpay refund is requested outside the transaction.
 * 3. Razorpay webhook finally confirms the refund.
 *
 * IMPORTANT:
 * A lost Razorpay response does NOT mean the refund failed.
 */
export async function initiateRazorpayRefund(
  paymentId: string,
  providerPaymentId: string,
  amount: number,
  reason: string,
) {
  /**
   * First check the current database state.
   */
  const payment = await prisma.payment.findUnique({
    where: {
      id: paymentId,
    },
    select: {
      id: true,
      status: true,
      refundId: true,
      refundAmount: true,
    },
  });

  if (!payment) {
    throw new Error("PAYMENT_NOT_FOUND");
  }

  /**
   * Already terminal.
   */
  if (
    payment.status === PaymentStatus.REFUNDED ||
    payment.status === PaymentStatus.PARTIALLY_REFUNDED
  ) {
    return {
      alreadyRefunded: true,
      alreadyPending: false,
      refundId: payment.refundId,
    };
  }

  /**
   * Refund request already created.
   */
  if (
    payment.status === PaymentStatus.REFUND_PENDING &&
    payment.refundId
  ) {
    return {
      alreadyRefunded: false,
      alreadyPending: true,
      refundId: payment.refundId,
    };
  }

  const refundAmount = toPaise(amount);

  let refund;

  try {
    refund = await razorpay.payments.refund(providerPaymentId, {
      amount: refundAmount,
      notes: {
        paymentId,
        reason,
      },
    });
  } catch (error) {
    console.error("RAZORPAY REFUND CREATION ERROR:", error);

    /**
     * IMPORTANT:
     *
     * Do not mark the refund as failed here.
     *
     * A timeout/network failure can happen after Razorpay
     * has actually created the refund.
     *
     * The caller keeps the payment in REFUND_PENDING.
     */
    throw new Error("REFUND_REQUEST_FAILED");
  }

  const refundId = safeString(refund?.id);

  if (!refundId) {
    throw new Error("REFUND_REQUEST_FAILED");
  }

  /**
   * ==========================================================
   * REFUND WEBHOOK RACE PROTECTION
   * ==========================================================
   *
   * Razorpay may send refund.processed extremely quickly.
   *
   * Therefore we MUST check the database again after the
   * Razorpay API call and before writing REFUND_PENDING.
   *
   * If the webhook already moved the payment to a terminal
   * refund state, never downgrade it back to REFUND_PENDING.
   */
  const updatedPayment = await prisma.payment.findUnique({
    where: {
      id: paymentId,
    },
    select: {
      id: true,
      status: true,
      refundId: true,
      refundAmount: true,
    },
  });

  if (!updatedPayment) {
    throw new Error("PAYMENT_NOT_FOUND");
  }

  /**
   * Webhook already completed the refund.
   */
  if (
    updatedPayment.status === PaymentStatus.REFUNDED ||
    updatedPayment.status === PaymentStatus.PARTIALLY_REFUNDED
  ) {
    return {
      alreadyRefunded: true,
      alreadyPending: false,
      refundId:
        updatedPayment.refundId ??
        refundId,
    };
  }

  /**
   * Another request may already have stored a refund ID.
   */
  if (
    updatedPayment.status === PaymentStatus.REFUND_PENDING &&
    updatedPayment.refundId
  ) {
    return {
      alreadyRefunded: false,
      alreadyPending: true,
      refundId: updatedPayment.refundId,
    };
  }

  /**
   * Only now write REFUND_PENDING.
   *
   * Conditional update prevents a terminal refund state from
   * being overwritten if another process changes it between
   * the SELECT and UPDATE.
   */
  const pendingUpdate = await prisma.payment.updateMany({
    where: {
      id: paymentId,
      status: {
        notIn: [
          PaymentStatus.REFUNDED,
          PaymentStatus.PARTIALLY_REFUNDED,
        ],
      },
    },
    data: {
      status: PaymentStatus.REFUND_PENDING,
      refundId,
      refundAmount: amount,
      refundReason: reason,
    },
  });

  /**
   * Another process won the race.
   */
  if (pendingUpdate.count !== 1) {
    const latestPayment = await prisma.payment.findUnique({
      where: {
        id: paymentId,
      },
      select: {
        status: true,
        refundId: true,
      },
    });

    if (!latestPayment) {
      throw new Error("PAYMENT_NOT_FOUND");
    }

    return {
      alreadyRefunded:
        latestPayment.status === PaymentStatus.REFUNDED ||
        latestPayment.status === PaymentStatus.PARTIALLY_REFUNDED,
      alreadyPending:
        latestPayment.status === PaymentStatus.REFUND_PENDING,
      refundId:
        latestPayment.refundId ??
        refundId,
    };
  }

  return {
    alreadyRefunded: false,
    alreadyPending: false,
    refundId,
  };
}

/**
 * ============================================================
 * PROCESS CAPTURED PAYMENT
 * ============================================================
 *
 * SINGLE SOURCE OF TRUTH for successful Razorpay capture.
 *
 * Called by:
 *
 * 1. Frontend verification
 * 2. Razorpay payment.captured webhook
 *
 * Stock is deducted ONLY here.
 */
export async function processCapturedPayment(
  providerOrderId: string,
  providerPaymentId: string,
) {
  let refundRequired:
    | {
        paymentId: string;
        providerPaymentId: string;
        amount: number;
        reason: string;
      }
    | undefined;

  const result = await prisma.$transaction(
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
       * Exact payment idempotency.
       */
      if (
        payment.status === PaymentStatus.PAID ||
        payment.status === PaymentStatus.PARTIALLY_PAID
      ) {
        return {
          success: true,
          alreadyProcessed: true,
          orderId: payment.orderId,
          orderNumber: payment.order.orderNumber,
          paymentId: payment.id,
          razorpayPaymentId:
            payment.providerPaymentId ??
            providerPaymentId,
          status: payment.status,
        };
      }

      /**
       * Refund already in progress/completed.
       */
      if (
        payment.status === PaymentStatus.REFUND_PENDING ||
        payment.status === PaymentStatus.REFUNDED ||
        payment.status === PaymentStatus.PARTIALLY_REFUNDED
      ) {
        return {
          success: false,
          alreadyProcessed: true,
          orderId: payment.orderId,
          orderNumber: payment.order.orderNumber,
          paymentId: payment.id,
          razorpayPaymentId:
            payment.providerPaymentId ??
            providerPaymentId,
          status: payment.status,
        };
      }

      /**
       * Payment ID mismatch protection.
       */
      if (
        payment.providerPaymentId &&
        payment.providerPaymentId !== providerPaymentId
      ) {
        throw new Error("PAYMENT_ID_MISMATCH");
      }

      /**
       * Cancelled order.
       *
       * If money was captured after cancellation,
       * refund it.
       */
      if (payment.order.status === OrderStatus.CANCELLED) {
        const reason =
          "Payment captured after order cancellation";

        refundRequired = {
          paymentId: payment.id,
          providerPaymentId,
          amount: toNumber(payment.amount),
          reason,
        };

        await tx.payment.update({
          where: {
            id: payment.id,
          },
          data: {
            providerPaymentId,
            status: PaymentStatus.REFUND_PENDING,
            refundAmount: payment.amount,
            refundReason: reason,
          },
        });

        return {
          success: false,
          alreadyProcessed: false,
          orderId: payment.orderId,
          orderNumber: payment.order.orderNumber,
          paymentId: payment.id,
          razorpayPaymentId: providerPaymentId,
          status: PaymentStatus.REFUND_PENDING,
        };
      }

      /**
       * ======================================================
       * STOCK
       * ======================================================
       *
       * Razorpay has already captured the customer's money.
       *
       * Therefore any known fulfillment/inventory failure
       * must result in REFUND_PENDING.
       */
      try {
        await deductStockAfterSuccessfulPayment(
          tx,
          payment.orderId,
        );
      } catch (error) {
        const refundableStockErrors = new Set([
          "INSUFFICIENT_STOCK_AFTER_PAYMENT",
          "VARIANT_NOT_FOUND",
          "VARIANT_REQUIRED",
          "ORDER_HAS_NO_ITEMS",
          "INVALID_ORDER_QUANTITY",
        ]);

        if (
          error instanceof Error &&
          refundableStockErrors.has(error.message)
        ) {
          const reason =
            `Payment captured but order could not be fulfilled: ${error.message}`;

          refundRequired = {
            paymentId: payment.id,
            providerPaymentId,
            amount: toNumber(payment.amount),
            reason,
          };

          await tx.payment.update({
            where: {
              id: payment.id,
            },
            data: {
              providerPaymentId,
              status: PaymentStatus.REFUND_PENDING,
              refundAmount: payment.amount,
              refundReason: reason,
            },
          });

          return {
            success: false,
            alreadyProcessed: false,
            orderId: payment.orderId,
            orderNumber: payment.order.orderNumber,
            paymentId: payment.id,
            razorpayPaymentId: providerPaymentId,
            status: PaymentStatus.REFUND_PENDING,
          };
        }

        /**
         * Unexpected DB/application failure.
         *
         * Transaction rolls back.
         *
         * IMPORTANT:
         * This is intentionally not converted into a refund
         * because the database transaction itself failed and
         * we cannot safely know what state was committed.
         */
        throw error;
      }

      /**
       * ======================================================
       * PAYMENT STATUS
       * ======================================================
       *
       * COD:
       * ₹500 captured → PARTIALLY_PAID
       *
       * UPI/Card/EMI:
       * Full amount captured → PAID
       */
      const isCod =
        payment.order.paymentMethod === PaymentMethod.COD;

      const newPaymentStatus = isCod
        ? PaymentStatus.PARTIALLY_PAID
        : PaymentStatus.PAID;

      const updatedPayment = await tx.payment.update({
        where: {
          id: payment.id,
        },
        data: {
          providerPaymentId,
          status: newPaymentStatus,
        },
      });

      await tx.order.update({
        where: {
          id: payment.orderId,
        },
        data: {
          paymentStatus: newPaymentStatus,
          status: OrderStatus.CONFIRMED,
        },
      });

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
        status: newPaymentStatus,
      };
    },
    {
      isolationLevel:
        Prisma.TransactionIsolationLevel.Serializable,
      timeout: 15000,
    },
  );

  /**
   * ==========================================================
   * EXECUTE REFUND AFTER TRANSACTION COMMIT
   * ==========================================================
   */
  if (refundRequired) {
    try {
      const refund = await initiateRazorpayRefund(
        refundRequired.paymentId,
        refundRequired.providerPaymentId,
        refundRequired.amount,
        refundRequired.reason,
      );

      return {
        ...result,
        refundId: refund.refundId,
        refundRequested: !refund.alreadyRefunded,
        refundPending:
          refund.alreadyPending ||
          false,
      };
    } catch (error) {
      console.error("REFUND REQUEST FAILED:", error);

      /**
       * Payment remains REFUND_PENDING.
       *
       * Never tell the customer that the money was refunded.
       */
      return {
        ...result,
        refundRequested: false,
        refundPending: true,
      };
    }
  }

  return result;
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
    order.paymentStatus === PaymentStatus.PAID ||
    order.paymentStatus === PaymentStatus.PARTIALLY_PAID
  ) {
    throw new Error("ORDER_ALREADY_PAID");
  }

  if (order.status === OrderStatus.CANCELLED) {
    throw new Error("ORDER_CANCELLED");
  }

  /**
   * Reuse pending/authorized payment only.
   */
  const existingPayment = await prisma.payment.findFirst({
    where: {
      orderId: order.id,
      provider: RAZORPAY_PROVIDER,
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
      razorpayOrderId: existingPayment.providerOrderId,
      amount: toNumber(existingPayment.amount),
      amountInPaise: toPaise(
        toNumber(existingPayment.amount),
      ),
      currency: existingPayment.currency,
      keyId: env.RAZORPAY_KEY_ID,
    };
  }

  /**
   * COD = ₹500 advance.
   *
   * UPI/Card/EMI = complete amount.
   */
  const amount =
    order.paymentMethod === PaymentMethod.COD
      ? COD_ADVANCE_AMOUNT
      : toNumber(order.totalAmount);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("INVALID_PAYMENT_AMOUNT");
  }

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
        paymentMethod: order.paymentMethod,
      },
    });
  } catch (error) {
    console.error(
      "RAZORPAY ORDER CREATION ERROR:",
      error,
    );

    throw error;
  }

  await prisma.payment.create({
    data: {
      orderId: order.id,
      provider: RAZORPAY_PROVIDER,
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
 * ============================================================
 * VERIFY RAZORPAY PAYMENT
 * ============================================================
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

  if (order.status === OrderStatus.CANCELLED) {
    throw new Error("ORDER_CANCELLED");
  }

  const payment = await prisma.payment.findFirst({
    where: {
      orderId: order.id,
      provider: RAZORPAY_PROVIDER,
      providerOrderId: razorpayOrderId,
    },
  });

  if (!payment) {
    throw new Error("PAYMENT_NOT_FOUND");
  }

  /**
   * Payment/order currency must match.
   */
  if (payment.currency !== order.currency) {
    throw new Error("PAYMENT_CURRENCY_MISMATCH");
  }

  /**
   * Amount comes from our DB.
   *
   * Never trust the browser amount.
   */
  const expectedAmountInPaise = toPaise(
    toNumber(payment.amount),
  );

  /**
   * Checkout signature.
   */
  const expectedSignature = crypto
    .createHmac(
      "sha256",
      env.RAZORPAY_KEY_SECRET,
    )
    .update(
      `${payment.providerOrderId}|${razorpayPaymentId}`,
    )
    .digest("hex");

  const receivedBuffer = Buffer.from(
    razorpaySignature,
    "utf8",
  );

  const expectedBuffer = Buffer.from(
    expectedSignature,
    "utf8",
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
   * Fetch authoritative Razorpay payment.
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
    payment.providerOrderId
  ) {
    throw new Error(
      "PAYMENT_ORDER_MISMATCH",
    );
  }

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

  /**
   * Only CAPTURED can consume stock.
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

  return processCapturedPayment(
    payment.providerOrderId!,
    razorpayPaymentId,
  );
}
