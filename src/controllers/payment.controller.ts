import type { Request, Response } from "express";

import crypto from "crypto";

import { PaymentStatus, Prisma } from "@prisma/client";

import { env } from "../config/env";
import { prisma } from "../config/prisma";

import type { AuthRequest } from "../middleware/auth.middleware";

import {
  createRazorpayOrder,
  processCapturedPayment,
  verifyRazorpayPayment,
} from "../services/payment.service";

/**
 * ============================================================
 * CREATE RAZORPAY ORDER
 * ============================================================
 *
 * POST
 * /api/v1/payments/orders/:orderId
 */

export async function createPaymentOrder(req: AuthRequest, res: Response) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const orderId = String(req.params.orderId);

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "Order ID is required",
      });
    }

    const payment = await createRazorpayOrder(req.userId, orderId);

    return res.status(201).json({
      success: true,
      message: "Razorpay order created successfully",
      data: payment,
    });
  } catch (error) {
    console.error("CREATE PAYMENT ORDER ERROR:", error);

    if (error instanceof Error) {
      switch (error.message) {
        case "ORDER_NOT_FOUND":
          return res.status(404).json({
            success: false,
            message: "Order not found",
          });

        case "ORDER_ALREADY_PAID":
          return res.status(409).json({
            success: false,
            message: "Order has already been paid",
          });

        case "ORDER_CANCELLED":
          return res.status(409).json({
            success: false,
            message: "Order has been cancelled",
          });

        case "INVALID_PAYMENT_AMOUNT":
          return res.status(400).json({
            success: false,
            message: "Invalid payment amount",
          });
      }
    }

    return res.status(500).json({
      success: false,
      message: "Unable to create payment order",
    });
  }
}

/**
 * ============================================================
 * VERIFY RAZORPAY CHECKOUT PAYMENT
 * ============================================================
 *
 * POST
 * /api/v1/payments/orders/:orderId/verify
 */

export async function verifyPayment(req: AuthRequest, res: Response) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const orderId = String(req.params.orderId);

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "Order ID is required",
      });
    }

    const { razorpayPaymentId, razorpayOrderId, razorpaySignature } = req.body;

    if (
      typeof razorpayPaymentId !== "string" ||
      typeof razorpayOrderId !== "string" ||
      typeof razorpaySignature !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid Razorpay payment response",
      });
    }

    const result = await verifyRazorpayPayment(
      req.userId,
      orderId,
      razorpayPaymentId,
      razorpayOrderId,
      razorpaySignature,
    );

    /*
     * Payment was captured but stock became unavailable.
     *
     * The service has already moved the payment to
     * REFUND_PENDING and attempted the Razorpay refund.
     */
    if (result.status === PaymentStatus.REFUND_PENDING) {
      return res.status(200).json({
        success: false,
        refundPending: true,
        message:
          "Payment was captured, but the requested stock was unavailable. A refund has been initiated.",
        data: result,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Payment verified successfully",
      data: result,
    });
  } catch (error) {
    console.error("VERIFY PAYMENT ERROR:", error);

    if (error instanceof Error) {
      switch (error.message) {
        case "ORDER_NOT_FOUND":
          return res.status(404).json({
            success: false,
            message: "Order not found",
          });

        case "PAYMENT_NOT_FOUND":
          return res.status(404).json({
            success: false,
            message: "Payment record not found",
          });

        case "INVALID_PAYMENT_RESPONSE":
          return res.status(400).json({
            success: false,
            message: "Invalid payment response",
          });

        case "INVALID_PAYMENT_SIGNATURE":
          return res.status(400).json({
            success: false,
            message: "Payment signature verification failed",
          });

        case "PAYMENT_VERIFICATION_FAILED":
          return res.status(502).json({
            success: false,
            message: "Unable to confirm payment with Razorpay",
          });

        case "PAYMENT_ORDER_MISMATCH":
          return res.status(400).json({
            success: false,
            message: "Payment does not belong to this order",
          });

        case "PAYMENT_ID_MISMATCH":
          return res.status(400).json({
            success: false,
            message: "Payment ID does not match the existing payment",
          });

        case "PAYMENT_AMOUNT_MISMATCH":
          return res.status(400).json({
            success: false,
            message: "Payment amount does not match the order",
          });

        case "PAYMENT_CURRENCY_MISMATCH":
          return res.status(400).json({
            success: false,
            message: "Payment currency does not match the order",
          });

        case "PAYMENT_NOT_CAPTURED":
          return res.status(409).json({
            success: false,
            message: "Payment has not been captured yet",
          });

        case "ORDER_CANCELLED":
          return res.status(409).json({
            success: false,
            message: "This order has already been cancelled",
          });

        case "VARIANT_REQUIRED":
          return res.status(409).json({
            success: false,
            message: "Product variant is required",
          });

        case "VARIANT_NOT_FOUND":
          return res.status(409).json({
            success: false,
            message: "The selected product variant is no longer available",
          });

        case "ORDER_HAS_NO_ITEMS":
          return res.status(409).json({
            success: false,
            message: "This order does not contain any items",
          });

        case "INVALID_ORDER_QUANTITY":
          return res.status(409).json({
            success: false,
            message: "The order contains an invalid quantity",
          });

        case "INSUFFICIENT_STOCK_AFTER_PAYMENT":
          return res.status(409).json({
            success: false,
            message:
              "Payment was captured, but the requested stock is no longer available. A refund is being processed.",
            refundPending: true,
          });
      }
    }

    return res.status(500).json({
      success: false,
      message: "Unable to verify payment",
    });
  }
}

/**
 * ============================================================
 * RAZORPAY WEBHOOK SIGNATURE
 * ============================================================
 */

function verifyWebhookSignature(req: Request): boolean {
  const signature = req.headers["x-razorpay-signature"];

  if (typeof signature !== "string" || !req.rawBody) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET)
    .update(req.rawBody)
    .digest("hex");

  const receivedBuffer = Buffer.from(signature, "utf8");

  const expectedBuffer = Buffer.from(expectedSignature, "utf8");

  if (receivedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

/**
 * ============================================================
 * PAYMENT FAILED
 * ============================================================
 */

async function handlePaymentFailed(
  paymentId: string,
  razorpayPaymentId: unknown,
  paymentEntity: any,
) {
  await prisma.$transaction(
    async (tx) => {
      const currentPayment = await tx.payment.findUnique({
        where: {
          id: paymentId,
        },
      });

      if (!currentPayment) {
        return;
      }

      /*
       * Never downgrade a payment which has already
       * successfully captured or entered refund flow.
       */
      if (
        currentPayment.status === PaymentStatus.PAID ||
        currentPayment.status === PaymentStatus.PARTIALLY_PAID ||
        currentPayment.status === PaymentStatus.REFUND_PENDING ||
        currentPayment.status === PaymentStatus.REFUNDED ||
        currentPayment.status === PaymentStatus.PARTIALLY_REFUNDED
      ) {
        return;
      }

      await tx.payment.update({
        where: {
          id: paymentId,
        },

        data: {
          status: PaymentStatus.FAILED,

          providerPaymentId:
            typeof razorpayPaymentId === "string"
              ? razorpayPaymentId
              : undefined,

          failureCode:
            typeof paymentEntity?.error_code === "string"
              ? paymentEntity.error_code
              : null,

          failureMessage:
            typeof paymentEntity?.error_description === "string"
              ? paymentEntity.error_description
              : null,
        },
      });

      await tx.order.update({
        where: {
          id: currentPayment.orderId,
        },

        data: {
          paymentStatus: PaymentStatus.FAILED,
        },
      });
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}

/**
 * ============================================================
 * PAYMENT AUTHORIZED
 * ============================================================
 *
 * IMPORTANT:
 *
 * Authorized is NOT captured.
 *
 * Therefore:
 *
 * NO STOCK DEDUCTION.
 */

async function handlePaymentAuthorized(
  paymentId: string,
  razorpayPaymentId: unknown,
) {
  await prisma.$transaction(
    async (tx) => {
      const currentPayment = await tx.payment.findUnique({
        where: {
          id: paymentId,
        },
      });

      if (!currentPayment) {
        return;
      }

      /*
       * Only PENDING -> AUTHORIZED.
       *
       * This prevents a late authorized webhook from
       * overwriting PAID / REFUND_PENDING / REFUNDED.
       */
      if (currentPayment.status !== PaymentStatus.PENDING) {
        return;
      }

      await tx.payment.update({
        where: {
          id: paymentId,
        },

        data: {
          status: PaymentStatus.AUTHORIZED,

          providerPaymentId:
            typeof razorpayPaymentId === "string"
              ? razorpayPaymentId
              : undefined,
        },
      });

      await tx.order.update({
        where: {
          id: currentPayment.orderId,
        },

        data: {
          paymentStatus: PaymentStatus.AUTHORIZED,
        },
      });
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}

/**
 * ============================================================
 * REFUND WEBHOOK
 * ============================================================
 *
 * Razorpay refund events do not contain the PhoneBhai order ID
 * directly. They contain the original Razorpay payment ID.
 *
 * We therefore locate the Payment using providerPaymentId.
 */

/**
 * refund.processed
 *
 * This is the important terminal success event.
 */
async function handleRefundProcessed(refundEntity: any) {
  const providerPaymentId = refundEntity?.payment_id;

  const refundId = refundEntity?.id;

  const refundAmountPaise = refundEntity?.amount;

  if (
    typeof providerPaymentId !== "string" ||
    typeof refundId !== "string" ||
    typeof refundAmountPaise !== "number"
  ) {
    throw new Error("INVALID_REFUND_WEBHOOK");
  }

  const refundAmount = Number((refundAmountPaise / 100).toFixed(2));

  await prisma.$transaction(
    async (tx) => {
      const payment = await tx.payment.findFirst({
        where: {
          providerPaymentId,
        },
      });

      if (!payment) {
        /*
         * Do not fail the webhook indefinitely for a payment
         * which is not owned by PhoneBhai.
         */
        console.warn("Unknown Razorpay refund payment:", providerPaymentId);

        return;
      }

      const originalAmount = Number(payment.amount);

      /*
       * Razorpay can retry the same webhook.
       *
       * If this exact refund ID was already processed,
       * do nothing again.
       */
      if (
        payment.refundId === refundId &&
        (payment.status === PaymentStatus.PARTIALLY_REFUNDED ||
          payment.status === PaymentStatus.REFUNDED)
      ) {
        return;
      }

      /*
       * A completed full refund must never be downgraded.
       */
      if (payment.status === PaymentStatus.REFUNDED) {
        return;
      }

      /*
       * refundAmount stores the cumulative refunded amount.
       *
       * REFUND_PENDING may already contain the requested
       * refund amount, so for the first processed refund
       * we use the actual webhook amount directly.
       *
       * For a later different partial refund, add the new
       * processed amount to the previous cumulative amount.
       */
      const previousRefundAmount =
        payment.status === PaymentStatus.PARTIALLY_REFUNDED
          ? Number(payment.refundAmount ?? 0)
          : 0;

      const cumulativeRefundAmount = Number(
        (previousRefundAmount + refundAmount).toFixed(2),
      );

      const isFullRefund = cumulativeRefundAmount >= originalAmount;

      const newStatus = isFullRefund
        ? PaymentStatus.REFUNDED
        : PaymentStatus.PARTIALLY_REFUNDED;

      await tx.payment.update({
        where: {
          id: payment.id,
        },
        data: {
          status: newStatus,
          refundId,
          refundAmount: cumulativeRefundAmount,
          refundedAt: new Date(),
        },
      });

      await tx.order.update({
        where: {
          id: payment.orderId,
        },

        data: {
          paymentStatus: newStatus,
        },
      });
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}

/**
 * ============================================================
 * REFUND FAILED
 * ============================================================
 *
 * We intentionally KEEP REFUND_PENDING.
 *
 * Why?
 *
 * There is no REFUND_FAILED state in the current Prisma enum.
 *
 * More importantly, a failed webhook should not make the system
 * falsely claim that the customer has received a refund.
 *
 * REFUND_PENDING means:
 *
 * "PhoneBhai still owes/awaits confirmation of this refund."
 *
 * It can therefore be reconciled/retried safely.
 */
async function handleRefundFailed(refundEntity: any) {
  const providerPaymentId = refundEntity?.payment_id;

  const refundId = refundEntity?.id;

  if (typeof providerPaymentId !== "string") {
    throw new Error("INVALID_REFUND_WEBHOOK");
  }

  await prisma.$transaction(
    async (tx) => {
      const payment = await tx.payment.findFirst({
        where: {
          providerPaymentId,
        },
      });

      if (!payment) {
        console.warn(
          "Unknown Razorpay failed refund payment:",
          providerPaymentId,
        );

        return;
      }

      /*
       * If it has already been successfully refunded,
       * never downgrade it.
       */
      if (
        payment.status === PaymentStatus.REFUNDED ||
        payment.status === PaymentStatus.PARTIALLY_REFUNDED
      ) {
        return;
      }

      const existingReason = payment.refundReason ?? "Refund pending";

      await tx.payment.update({
        where: {
          id: payment.id,
        },

        data: {
          status: PaymentStatus.REFUND_PENDING,

          refundId: typeof refundId === "string" ? refundId : payment.refundId,

          refundReason: `${existingReason} | Razorpay refund failed or requires retry`,
        },
      });

      await tx.order.update({
        where: {
          id: payment.orderId,
        },

        data: {
          paymentStatus: PaymentStatus.REFUND_PENDING,
        },
      });
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}

/**
 * ============================================================
 * RAZORPAY WEBHOOK
 * ============================================================
 *
 * POST
 * /api/v1/payments/webhook
 *
 * NO JWT AUTHENTICATION.
 */

export async function razorpayWebhook(req: Request, res: Response) {
  try {
    /*
     * ========================================================
     * 1. Verify webhook signature
     * ========================================================
     */

    if (!verifyWebhookSignature(req)) {
      return res.status(401).json({
        success: false,
        message: "Invalid webhook signature",
      });
    }

    /*
     * ========================================================
     * 2. Validate event
     * ========================================================
     */

    const event = req.body?.event;

    if (typeof event !== "string") {
      return res.status(400).json({
        success: false,
        message: "Invalid Razorpay webhook event",
      });
    }

    /*
     * ========================================================
     * 3. Ignore unrelated Razorpay events
     * ========================================================
     *
     * We intentionally acknowledge events that PhoneBhai
     * doesn't need to process.
     */

    const supportedEvents = new Set([
      "payment.authorized",
      "payment.captured",
      "payment.failed",
      "refund.created",
      "refund.processed",
      "refund.failed",
    ]);

    if (!supportedEvents.has(event)) {
      return res.status(200).json({
        success: true,
        message: "Webhook acknowledged",
      });
    }

    /*
     * ========================================================
     * 4. REFUND EVENTS
     * ========================================================
     *
     * Refund events contain:
     *
     * payload.refund.entity
     *
     * rather than payment.entity.
     */

    if (
      event === "refund.created" ||
      event === "refund.processed" ||
      event === "refund.failed"
    ) {
      const refundEntity = req.body?.payload?.refund?.entity;

      if (!refundEntity) {
        return res.status(400).json({
          success: false,
          message: "Refund entity missing",
        });
      }

      if (event === "refund.created") {
        /*
         * The payment service already marks the DB as
         * REFUND_PENDING when the refund request is created.
         *
         * refund.created is therefore informational/idempotent.
         */
        return res.status(200).json({
          success: true,
          message: "Refund creation acknowledged",
        });
      }

      if (event === "refund.processed") {
        await handleRefundProcessed(refundEntity);

        return res.status(200).json({
          success: true,
          message: "Refund processed successfully",
        });
      }

      await handleRefundFailed(refundEntity);

      return res.status(200).json({
        success: true,
        message: "Refund failure recorded; refund remains pending",
      });
    }

    /*
     * ========================================================
     * 5. PAYMENT EVENTS
     * ========================================================
     */

    const paymentEntity = req.body?.payload?.payment?.entity;

    if (!paymentEntity) {
      return res.status(400).json({
        success: false,
        message: "Payment entity missing",
      });
    }

    const razorpayOrderId = paymentEntity?.order_id;

    const razorpayPaymentId = paymentEntity?.id;

    if (typeof razorpayOrderId !== "string") {
      return res.status(400).json({
        success: false,
        message: "Razorpay order ID missing",
      });
    }

    /*
     * ========================================================
     * 6. Find PhoneBhai payment
     * ========================================================
     */

    const payment = await prisma.payment.findUnique({
      where: {
        providerOrderId: razorpayOrderId,
      },
    });

    /*
     * Unknown Razorpay order.
     *
     * Acknowledge rather than causing endless retries.
     */

    if (!payment) {
      console.warn("Unknown Razorpay payment order:", razorpayOrderId);

      return res.status(200).json({
        success: true,
        message: "Webhook acknowledged",
      });
    }

    /*
     * ========================================================
     * 7. PAYMENT FAILED
     * ========================================================
     *
     * NEVER touch stock.
     */

    if (event === "payment.failed") {
      await handlePaymentFailed(payment.id, razorpayPaymentId, paymentEntity);

      return res.status(200).json({
        success: true,
        message: "Payment failure processed",
      });
    }

    /*
     * ========================================================
     * 8. PAYMENT AUTHORIZED
     * ========================================================
     *
     * Authorized != captured.
     *
     * NO STOCK DEDUCTION.
     */

    if (event === "payment.authorized") {
      await handlePaymentAuthorized(payment.id, razorpayPaymentId);

      return res.status(200).json({
        success: true,
        message: "Payment authorization processed",
      });
    }

    /*
     * ========================================================
     * 9. PAYMENT CAPTURED
     * ========================================================
     *
     * THIS IS THE ONLY PAYMENT EVENT THAT CAN DEDUCT STOCK.
     *
     * processCapturedPayment() handles:
     *
     * - stock validation
     * - atomic stock deduction
     * - payment status
     * - order status
     * - cart cleanup
     * - refund initiation when stock is unavailable
     */

    if (event === "payment.captured") {
      if (typeof razorpayPaymentId !== "string") {
        return res.status(400).json({
          success: false,
          message: "Razorpay payment ID missing",
        });
      }

      const result = await processCapturedPayment(
        razorpayOrderId,
        razorpayPaymentId,
      );

      /*
       * Payment was captured but stock was unavailable.
       *
       * The service has already placed the payment into
       * REFUND_PENDING and attempted the refund.
       */
      if (result.status === PaymentStatus.REFUND_PENDING) {
        return res.status(200).json({
          success: true,
          refundPending: true,
          message:
            "refundRequested" in result && result.refundRequested
              ? "Payment was captured but stock was unavailable. Refund initiated."
              : "Payment was captured but stock was unavailable. Refund remains pending.",
          data: result,
        });
      }

      return res.status(200).json({
        success: true,

        message: result.alreadyProcessed
          ? "Payment already processed"
          : "Payment capture processed",

        data: result,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Webhook processed",
    });
  } catch (error) {
    console.error("RAZORPAY WEBHOOK ERROR:", error);

    /*
     * 500 intentionally causes Razorpay to retry the webhook.
     *
     * This is preferable to acknowledging a webhook that
     * PhoneBhai failed to process.
     */

    return res.status(500).json({
      success: false,
      message: "Webhook processing failed",
    });
  }
}
