
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
 * CREATE RAZORPAY ORDER
 * POST /api/v1/payments/orders/:orderId
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
 * VERIFY RAZORPAY CHECKOUT PAYMENT
 * POST /api/v1/payments/orders/:orderId/verify
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

    const {
      razorpayPaymentId,
      razorpayOrderId,
      razorpaySignature,
    } = req.body;

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
 * VERIFY RAZORPAY WEBHOOK SIGNATURE
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
 * RECALCULATE ORDER PAYMENT STATUS
 *
 * Calculates the order's payment status using all payment
 * transactions and processed refund ledger entries.
 */
async function recalculateOrderPaymentStatus(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<PaymentStatus> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { totalAmount: true },
  });

  if (!order) {
    throw new Error("ORDER_NOT_FOUND");
  }

  const payments = await tx.payment.findMany({
    where: { orderId },
    include: {
      refunds: {
        select: {
          amount: true,
          status: true,
        },
      },
    },
  });

  let collectedInPaise = 0;

  for (const payment of payments) {
    const amountInPaise = Math.round(Number(payment.amount) * 100);

    const countsAsCollected =
      payment.status === PaymentStatus.PAID ||
      payment.status === PaymentStatus.PARTIALLY_PAID ||
      payment.status === PaymentStatus.REFUND_PENDING ||
      payment.status === PaymentStatus.PARTIALLY_REFUNDED;

    if (!countsAsCollected) {
      continue;
    }

    const processedRefundsInPaise = payment.refunds
      .filter((refund) => refund.status === "PROCESSED")
      .reduce(
        (sum, refund) =>
          sum + Math.round(Number(refund.amount) * 100),
        0,
      );

    let refundedInPaise = processedRefundsInPaise;

    // Fallback for older records without refund ledger entries.
    if (
      processedRefundsInPaise === 0 &&
      payment.status === PaymentStatus.PARTIALLY_REFUNDED
    ) {
      refundedInPaise = Math.round(
        Number(payment.refundAmount ?? 0) * 100,
      );
    }

    collectedInPaise += Math.max(
      0,
      amountInPaise - refundedInPaise,
    );
  }

  const totalInPaise = Math.round(Number(order.totalAmount) * 100);

  let nextStatus: PaymentStatus;

  if (
    payments.some(
      (payment) => payment.status === PaymentStatus.REFUND_PENDING,
    )
  ) {
    nextStatus = PaymentStatus.REFUND_PENDING;
  } else if (collectedInPaise >= totalInPaise && totalInPaise > 0) {
    nextStatus = PaymentStatus.PAID;
  } else if (collectedInPaise > 0) {
    nextStatus = PaymentStatus.PARTIALLY_PAID;
  } else if (
    payments.some(
      (payment) => payment.status === PaymentStatus.AUTHORIZED,
    )
  ) {
    nextStatus = PaymentStatus.AUTHORIZED;
  } else if (
    payments.some(
      (payment) => payment.status === PaymentStatus.PENDING,
    )
  ) {
    nextStatus = PaymentStatus.PENDING;
  } else if (
    payments.some(
      (payment) =>
        payment.status === PaymentStatus.REFUNDED ||
        payment.status === PaymentStatus.PARTIALLY_REFUNDED,
    ) &&
    !payments.some(
      (payment) =>
        payment.status === PaymentStatus.PAID ||
        payment.status === PaymentStatus.PARTIALLY_PAID ||
        payment.status === PaymentStatus.REFUND_PENDING,
    )
  ) {
    nextStatus = PaymentStatus.REFUNDED;
  } else if (
    payments.some(
      (payment) => payment.status === PaymentStatus.FAILED,
    )
  ) {
    nextStatus = PaymentStatus.FAILED;
  } else {
    nextStatus = PaymentStatus.PENDING;
  }

  await tx.order.update({
    where: { id: orderId },
    data: { paymentStatus: nextStatus },
  });

  return nextStatus;
}

/**
 * PAYMENT FAILED
 *
 * Never downgrade an already successful or refund-related payment.
 * Failed payment attempts must not change stock.
 */
async function handlePaymentFailed(
  paymentId: string,
  razorpayPaymentId: unknown,
  paymentEntity: any,
) {
  await prisma.$transaction(
    async (tx) => {
      const currentPayment = await tx.payment.findUnique({
        where: { id: paymentId },
      });

      if (!currentPayment) {
        return;
      }

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
        where: { id: paymentId },
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

      await recalculateOrderPaymentStatus(
        tx,
        currentPayment.orderId,
      );
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}

/**
 * PAYMENT AUTHORIZED
 *
 * Authorization is not capture.
 * No stock deduction takes place here.
 */
async function handlePaymentAuthorized(
  paymentId: string,
  razorpayPaymentId: unknown,
) {
  await prisma.$transaction(
    async (tx) => {
      const currentPayment = await tx.payment.findUnique({
        where: { id: paymentId },
      });

      if (!currentPayment) {
        return;
      }

      if (currentPayment.status !== PaymentStatus.PENDING) {
        return;
      }

      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.AUTHORIZED,
          providerPaymentId:
            typeof razorpayPaymentId === "string"
              ? razorpayPaymentId
              : undefined,
        },
      });

      await recalculateOrderPaymentStatus(
        tx,
        currentPayment.orderId,
      );
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}

/**
 * REFUND PROCESSED
 *
 * Uses the refund ledger to avoid counting duplicate webhook
 * deliveries more than once.
 */
async function handleRefundProcessed(refundEntity: any) {
  const providerPaymentId = refundEntity?.payment_id;
  const refundId = refundEntity?.id;
  const refundAmountPaise = refundEntity?.amount;
  const notes = refundEntity?.notes;

  if (
    typeof providerPaymentId !== "string" ||
    typeof refundId !== "string" ||
    !Number.isSafeInteger(refundAmountPaise) ||
    refundAmountPaise <= 0
  ) {
    throw new Error("INVALID_REFUND_WEBHOOK");
  }

  const refundAmount = Number(
    (refundAmountPaise / 100).toFixed(2),
  );

  const noteRequestKey =
    typeof notes?.refundRequestKey === "string" &&
    notes.refundRequestKey.startsWith("pb_")
      ? notes.refundRequestKey
      : undefined;

  await prisma.$transaction(
    async (tx) => {
      const payment = await tx.payment.findFirst({
        where: { providerPaymentId },
      });

      if (!payment) {
        console.warn(
          "Unknown Razorpay refund payment:",
          providerPaymentId,
        );
        return;
      }

      let refundRecord = await tx.paymentRefund.findUnique({
        where: { providerRefundId: refundId },
      });

      if (
        refundRecord &&
        refundRecord.paymentId !== payment.id
      ) {
        throw new Error("REFUND_PAYMENT_MISMATCH");
      }

      if (refundRecord?.status === "PROCESSED") {
        return;
      }

      let requestRecord = noteRequestKey
        ? await tx.paymentRefund.findUnique({
            where: { requestKey: noteRequestKey },
          })
        : null;

      if (
        requestRecord &&
        requestRecord.paymentId !== payment.id
      ) {
        throw new Error("REFUND_REQUEST_PAYMENT_MISMATCH");
      }

      if (
        requestRecord?.providerRefundId &&
        requestRecord.providerRefundId !== refundId
      ) {
        throw new Error("REFUND_REQUEST_ID_MISMATCH");
      }

      if (
        refundRecord &&
        requestRecord &&
        refundRecord.id !== requestRecord.id
      ) {
        if (requestRecord.status === "PROCESSED") {
          throw new Error("REFUND_LEDGER_CONFLICT");
        }

        await tx.paymentRefund.delete({
          where: { id: requestRecord.id },
        });

        requestRecord = null;
      }

      if (!refundRecord && requestRecord) {
        refundRecord = requestRecord;
      }

      if (refundRecord) {
        await tx.paymentRefund.update({
          where: { id: refundRecord.id },
          data: {
            providerRefundId: refundId,
            amount: refundAmount,
            status: "PROCESSED",
            processedAt: new Date(),
          },
        });
      } else {
        await tx.paymentRefund.create({
          data: {
            paymentId: payment.id,
            requestKey: `razorpay_${refundId}`,
            providerRefundId: refundId,
            amount: refundAmount,
            status: "PROCESSED",
            processedAt: new Date(),
          },
        });
      }

      const refundTotals = await tx.paymentRefund.aggregate({
        where: {
          paymentId: payment.id,
          status: "PROCESSED",
        },
        _sum: { amount: true },
      });

      const cumulativeRefundAmount = Number(
        Number(refundTotals._sum.amount ?? 0).toFixed(2),
      );

      const originalAmount = Number(payment.amount);

      if (cumulativeRefundAmount > originalAmount) {
        throw new Error("REFUND_TOTAL_EXCEEDS_PAYMENT_AMOUNT");
      }

      const newStatus =
        cumulativeRefundAmount >= originalAmount
          ? PaymentStatus.REFUNDED
          : PaymentStatus.PARTIALLY_REFUNDED;

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: newStatus,
          refundId,
          refundAmount: cumulativeRefundAmount,
          refundedAt: new Date(),
        },
      });

      await recalculateOrderPaymentStatus(
        tx,
        payment.orderId,
      );
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}


/**
 * REFUND FAILED
 *
 * Record the provider-confirmed failure in the refund ledger.
 * Do not leave a failed refund as REQUESTED.
 *
 * A failed refund does not mean the original payment was reversed.
 * The customer still has the previously captured payment, less
 * any other refunds that have actually been processed.
 */
async function handleRefundFailed(refundEntity: any) {
  const providerPaymentId = refundEntity?.payment_id;
  const refundId = refundEntity?.id;
  const refundAmountPaise = refundEntity?.amount;
  const notes = refundEntity?.notes;

  if (
    typeof providerPaymentId !== "string" ||
    typeof refundId !== "string" ||
    !Number.isSafeInteger(refundAmountPaise) ||
    refundAmountPaise <= 0
  ) {
    throw new Error("INVALID_REFUND_WEBHOOK");
  }

  const refundAmount = Number(
    (refundAmountPaise / 100).toFixed(2),
  );

  const noteRequestKey =
    typeof notes?.refundRequestKey === "string" &&
    notes.refundRequestKey.startsWith("pb_")
      ? notes.refundRequestKey
      : undefined;

  await prisma.$transaction(
    async (tx) => {
      const paymentReference = await tx.payment.findFirst({
        where: {
          providerPaymentId,
        },
        select: {
          id: true,
          orderId: true,
        },
      });

      if (!paymentReference) {
        console.warn(
          "Unknown Razorpay failed refund payment:",
          providerPaymentId,
        );
        return;
      }

      // Serialize refund updates for this order.
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "Order"
        WHERE "id" = ${paymentReference.orderId}
        FOR UPDATE
      `;

      const payment = await tx.payment.findUnique({
        where: {
          id: paymentReference.id,
        },
        include: {
          refunds: true,
        },
      });

      if (!payment) {
        throw new Error("PAYMENT_NOT_FOUND");
      }

      let refundRecord = await tx.paymentRefund.findUnique({
        where: {
          providerRefundId: refundId,
        },
      });

      let requestRecord = noteRequestKey
        ? await tx.paymentRefund.findUnique({
            where: {
              requestKey: noteRequestKey,
            },
          })
        : null;

      if (
        refundRecord &&
        refundRecord.paymentId !== payment.id
      ) {
        throw new Error("REFUND_PAYMENT_MISMATCH");
      }

      if (
        requestRecord &&
        requestRecord.paymentId !== payment.id
      ) {
        throw new Error("REFUND_REQUEST_PAYMENT_MISMATCH");
      }

      if (
        requestRecord?.providerRefundId &&
        requestRecord.providerRefundId !== refundId
      ) {
        throw new Error("REFUND_REQUEST_ID_MISMATCH");
      }

      // If the provider refund ID and request key point to two
      // different rows, preserve the canonical provider-ID row.
      if (
        refundRecord &&
        requestRecord &&
        refundRecord.id !== requestRecord.id
      ) {
        if (requestRecord.status === "PROCESSED") {
          throw new Error("REFUND_LEDGER_CONFLICT");
        }

        await tx.paymentRefund.delete({
          where: {
            id: requestRecord.id,
          },
        });

        requestRecord = null;
      }

      if (!refundRecord && requestRecord) {
        refundRecord = requestRecord;
      }

      // Duplicate webhook delivery must never downgrade a
      // refund that has already been confirmed as processed.
      if (refundRecord?.status === "PROCESSED") {
        return;
      }

      if (refundRecord) {
        await tx.paymentRefund.update({
          where: {
            id: refundRecord.id,
          },
          data: {
            providerRefundId: refundId,
            amount: refundAmount,
            status: "FAILED",
            processedAt: null,
          },
        });
      } else {
        // Fallback for a provider refund that arrived before
        // its original request record was saved.
        await tx.paymentRefund.create({
          data: {
            paymentId: payment.id,
            requestKey: `razorpay_${refundId}`,
            providerRefundId: refundId,
            amount: refundAmount,
            status: "FAILED",
          },
        });
      }

      const allRefunds = await tx.paymentRefund.findMany({
        where: {
          paymentId: payment.id,
        },
      });

      const processedAmount = allRefunds
        .filter((item) => item.status === "PROCESSED")
        .reduce(
          (sum, item) => sum + Number(item.amount),
          0,
        );

      const originalAmount = Number(payment.amount);

      if (processedAmount > originalAmount) {
        throw new Error("REFUND_TOTAL_EXCEEDS_PAYMENT_AMOUNT");
      }

      const pendingRefund = allRefunds.find(
        (item) =>
          item.status === "REQUESTED" ||
          item.status === "MANUAL_PENDING",
      );

      const nextPaymentStatus = pendingRefund
        ? PaymentStatus.REFUND_PENDING
        : processedAmount >= originalAmount
          ? PaymentStatus.REFUNDED
          : processedAmount > 0
            ? PaymentStatus.PARTIALLY_REFUNDED
            : PaymentStatus.PAID;

      await tx.payment.update({
        where: {
          id: payment.id,
        },
        data: {
          status: nextPaymentStatus,
          refundId: pendingRefund?.providerRefundId ?? null,
          refundAmount: Number(processedAmount.toFixed(2)),
          refundedAt:
            nextPaymentStatus === PaymentStatus.REFUNDED
              ? new Date()
              : null,
        },
      });

      await recalculateOrderPaymentStatus(
        tx,
        payment.orderId,
      );
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 15000,
    },
  );
}


/**
 * RAZORPAY WEBHOOK
 * POST /api/v1/payments/webhook
 *
 * No JWT authentication. Signature verification is mandatory.
 */
export async function razorpayWebhook(req: Request, res: Response) {
  try {
    if (!verifyWebhookSignature(req)) {
      return res.status(401).json({
        success: false,
        message: "Invalid webhook signature",
      });
    }

    const event = req.body?.event;

    if (typeof event !== "string") {
      return res.status(400).json({
        success: false,
        message: "Invalid Razorpay webhook event",
      });
    }

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

    // REFUND EVENTS
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

    // PAYMENT EVENTS
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

    const payment = await prisma.payment.findUnique({
      where: {
        providerOrderId: razorpayOrderId,
      },
    });

    if (!payment) {
      console.warn(
        "Unknown Razorpay payment order:",
        razorpayOrderId,
      );

      return res.status(200).json({
        success: true,
        message: "Webhook acknowledged",
      });
    }

    // PAYMENT FAILED
    if (event === "payment.failed") {
      await handlePaymentFailed(
        payment.id,
        razorpayPaymentId,
        paymentEntity,
      );

      return res.status(200).json({
        success: true,
        message: "Payment failure processed",
      });
    }

    // PAYMENT AUTHORIZED
    if (event === "payment.authorized") {
      await handlePaymentAuthorized(
        payment.id,
        razorpayPaymentId,
      );

      return res.status(200).json({
        success: true,
        message: "Payment authorization processed",
      });
    }

    // PAYMENT CAPTURED
    if (event === "payment.captured") {
      if (typeof razorpayPaymentId !== "string") {
        return res.status(400).json({
          success: false,
          message: "Razorpay payment ID missing",
        });
      }

      const capturedAmount = paymentEntity?.amount;
      const capturedCurrency = paymentEntity?.currency;

      const expectedAmountPaise = Math.round(
        Number(payment.amount) * 100,
      );

      if (
        typeof capturedAmount !== "number" ||
        capturedAmount !== expectedAmountPaise ||
        typeof capturedCurrency !== "string" ||
        capturedCurrency !== payment.currency
      ) {
        console.error(
          "RAZORPAY WEBHOOK AMOUNT/CURRENCY MISMATCH",
          {
            paymentId: payment.id,
            amountMatches:
              typeof capturedAmount === "number" &&
              capturedAmount === expectedAmountPaise,
            currencyMatches:
              typeof capturedCurrency === "string" &&
              capturedCurrency === payment.currency,
          },
        );

        return res.status(400).json({
          success: false,
          message: "Captured payment amount or currency mismatch",
        });
      }

      const result = await processCapturedPayment(
        razorpayOrderId,
        razorpayPaymentId,
      );

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

    // A 500 response allows Razorpay to retry the webhook.
    return res.status(500).json({
      success: false,
      message: "Webhook processing failed",
    });
  }
}
