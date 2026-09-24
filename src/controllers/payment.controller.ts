import type {
  Request,
  Response,
} from "express";

import crypto from "crypto";

import {
  PaymentStatus,
  Prisma,
} from "@prisma/client";

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

export async function createPaymentOrder(
  req: AuthRequest,
  res: Response,
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message:
          "Authentication required",
      });
    }

    const orderId =
      String(req.params.orderId);

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message:
          "Order ID is required",
      });
    }

    const payment =
      await createRazorpayOrder(
        req.userId,
        orderId,
      );

    return res.status(201).json({
      success: true,

      message:
        "Razorpay order created successfully",

      data: payment,
    });
  } catch (error) {
    console.error(
      "CREATE PAYMENT ORDER ERROR:",
      error,
    );

    if (error instanceof Error) {
      switch (
        error.message
      ) {
        case "ORDER_NOT_FOUND":
          return res.status(404).json({
            success: false,
            message:
              "Order not found",
          });

        case "ORDER_ALREADY_PAID":
          return res.status(409).json({
            success: false,
            message:
              "Order has already been paid",
          });

        case "ORDER_CANCELLED":
          return res.status(409).json({
            success: false,
            message:
              "Order has been cancelled",
          });

        case "INVALID_PAYMENT_AMOUNT":
          return res.status(400).json({
            success: false,
            message:
              "Invalid payment amount",
          });
      }
    }

    return res.status(500).json({
      success: false,

      message:
        "Unable to create payment order",
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

export async function verifyPayment(
  req: AuthRequest,
  res: Response,
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message:
          "Authentication required",
      });
    }

    const orderId =
      String(req.params.orderId);

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message:
          "Order ID is required",
      });
    }

    const {
      razorpayPaymentId,
      razorpayOrderId,
      razorpaySignature,
    } = req.body;

    if (
      typeof razorpayPaymentId !==
        "string" ||
      typeof razorpayOrderId !==
        "string" ||
      typeof razorpaySignature !==
        "string"
    ) {
      return res.status(400).json({
        success: false,

        message:
          "Invalid Razorpay payment response",
      });
    }

    const result =
      await verifyRazorpayPayment(
        req.userId,
        orderId,
        razorpayPaymentId,
        razorpayOrderId,
        razorpaySignature,
      );

    return res.status(200).json({
      success: true,

      message:
        "Payment verified successfully",

      data: result,
    });
  } catch (error) {
    console.error(
      "VERIFY PAYMENT ERROR:",
      error,
    );

    if (error instanceof Error) {
      switch (
        error.message
      ) {
        case "ORDER_NOT_FOUND":
          return res.status(404).json({
            success: false,
            message:
              "Order not found",
          });

        case "PAYMENT_NOT_FOUND":
          return res.status(404).json({
            success: false,
            message:
              "Payment record not found",
          });

        case "INVALID_PAYMENT_RESPONSE":
          return res.status(400).json({
            success: false,
            message:
              "Invalid payment response",
          });

        case "INVALID_PAYMENT_SIGNATURE":
          return res.status(400).json({
            success: false,
            message:
              "Payment signature verification failed",
          });

        case "PAYMENT_VERIFICATION_FAILED":
          return res.status(502).json({
            success: false,
            message:
              "Unable to confirm payment with Razorpay",
          });

        case "PAYMENT_ORDER_MISMATCH":
          return res.status(400).json({
            success: false,
            message:
              "Payment does not belong to this order",
          });

        case "PAYMENT_AMOUNT_MISMATCH":
          return res.status(400).json({
            success: false,
            message:
              "Payment amount does not match the order",
          });

        case "PAYMENT_CURRENCY_MISMATCH":
          return res.status(400).json({
            success: false,
            message:
              "Payment currency does not match the order",
          });

        case "PAYMENT_NOT_CAPTURED":
          return res.status(409).json({
            success: false,
            message:
              "Payment has not been captured yet",
          });

        case "INSUFFICIENT_STOCK_AFTER_PAYMENT":
          return res.status(409).json({
            success: false,
            message:
              "Payment was captured, but the requested stock is no longer available",
          });

        case "VARIANT_REQUIRED":
          return res.status(409).json({
            success: false,
            message:
              "Product variant is required",
          });
      }
    }

    return res.status(500).json({
      success: false,

      message:
        "Unable to verify payment",
    });
  }
}

/**
 * ============================================================
 * RAZORPAY WEBHOOK
 * ============================================================
 *
 * POST
 * /api/v1/payments/webhook
 *
 * No JWT authentication.
 *
 * Razorpay authenticates this request using
 * x-razorpay-signature.
 */

export async function razorpayWebhook(
  req: Request,
  res: Response,
) {
  try {
    const signature =
      req.headers[
        "x-razorpay-signature"
      ];

    if (
      typeof signature !==
      "string"
    ) {
      return res.status(400).json({
        success: false,

        message:
          "Missing Razorpay webhook signature",
      });
    }

    if (!req.rawBody) {
      console.error(
        "Razorpay webhook raw body missing",
      );

      return res.status(400).json({
        success: false,

        message:
          "Webhook raw body unavailable",
      });
    }

    /*
     * Verify exact webhook body.
     */

    const expectedSignature =
      crypto
        .createHmac(
          "sha256",
          env.RAZORPAY_WEBHOOK_SECRET,
        )
        .update(req.rawBody)
        .digest("hex");

    const receivedBuffer =
      Buffer.from(signature);

    const expectedBuffer =
      Buffer.from(
        expectedSignature,
      );

    if (
      receivedBuffer.length !==
      expectedBuffer.length
    ) {
      return res.status(401).json({
        success: false,

        message:
          "Invalid webhook signature",
      });
    }

    if (
      !crypto.timingSafeEqual(
        receivedBuffer,
        expectedBuffer,
      )
    ) {
      return res.status(401).json({
        success: false,

        message:
          "Invalid webhook signature",
      });
    }

    const event =
      req.body?.event;

    const paymentEntity =
      req.body?.payload?.payment
        ?.entity;

    if (
      typeof event !==
      "string"
    ) {
      return res.status(400).json({
        success: false,

        message:
          "Invalid Razorpay webhook event",
      });
    }

    /*
     * We only care about these payment events.
     */

    if (
      event !==
        "payment.authorized" &&
      event !==
        "payment.captured" &&
      event !==
        "payment.failed"
    ) {
      return res.status(200).json({
        success: true,

        message:
          "Webhook acknowledged",
      });
    }

    const razorpayOrderId =
      paymentEntity?.order_id;

    const razorpayPaymentId =
      paymentEntity?.id;

    if (
      typeof razorpayOrderId !==
      "string"
    ) {
      return res.status(400).json({
        success: false,

        message:
          "Razorpay order ID missing",
      });
    }

    /*
     * Find the payment created by PhoneBhai.
     */

    const payment =
      await prisma.payment.findUnique({
        where: {
          providerOrderId:
            razorpayOrderId,
        },
      });

    /*
     * Unknown Razorpay order.
     *
     * Acknowledge it instead of causing endless retries.
     */

    if (!payment) {
      console.warn(
        "Unknown Razorpay payment order:",
        razorpayOrderId,
      );

      return res.status(200).json({
        success: true,

        message:
          "Webhook acknowledged",
      });
    }

    /*
     * =====================================================
     * PAYMENT FAILED
     * =====================================================
     *
     * NEVER touch stock.
     */

    if (
      event ===
      "payment.failed"
    ) {
      await prisma.$transaction(
        async (tx) => {
          const currentPayment =
            await tx.payment.findUnique({
              where: {
                id: payment.id,
              },
            });

          if (!currentPayment) {
            return;
          }

          /*
           * Never downgrade a successful payment.
           */

          if (
            currentPayment.status ===
              PaymentStatus.PAID ||
            currentPayment.status ===
              PaymentStatus.REFUNDED
          ) {
            return;
          }

          await tx.payment.update({
            where: {
              id: payment.id,
            },

            data: {
              status:
                PaymentStatus.FAILED,

              providerPaymentId:
                typeof razorpayPaymentId ===
                "string"
                  ? razorpayPaymentId
                  : undefined,

              failureCode:
                typeof paymentEntity
                    ?.error_code ===
                  "string"
                    ? paymentEntity
                        .error_code
                    : null,

              failureMessage:
                typeof paymentEntity
                    ?.error_description ===
                  "string"
                    ? paymentEntity
                        .error_description
                    : null,
            },
          });
        },
        {
          isolationLevel:
            Prisma.TransactionIsolationLevel.Serializable,
        },
      );

      return res.status(200).json({
        success: true,

        message:
          "Payment failure processed",
      });
    }

    /*
     * =====================================================
     * PAYMENT AUTHORIZED
     * =====================================================
     *
     * IMPORTANT:
     *
     * Authorized is NOT captured.
     *
     * Therefore:
     *
     * NO stock deduction.
     */

    if (
      event ===
      "payment.authorized"
    ) {
      await prisma.$transaction(
        async (tx) => {
          const currentPayment =
            await tx.payment.findUnique({
              where: {
                id: payment.id,
              },
            });

          if (!currentPayment) {
            return;
          }

          if (
            currentPayment.status ===
              PaymentStatus.PAID ||
            currentPayment.status ===
              PaymentStatus.REFUNDED
          ) {
            return;
          }

          await tx.payment.update({
            where: {
              id: payment.id,
            },

            data: {
              status:
                PaymentStatus.AUTHORIZED,

              providerPaymentId:
                typeof razorpayPaymentId ===
                "string"
                  ? razorpayPaymentId
                  : undefined,
            },
          });

          await tx.order.update({
            where: {
              id: payment.orderId,
            },

            data: {
              paymentStatus:
                PaymentStatus.AUTHORIZED,
            },
          });
        },
        {
          isolationLevel:
            Prisma.TransactionIsolationLevel.Serializable,
        },
      );

      return res.status(200).json({
        success: true,

        message:
          "Payment authorization processed",
      });
    }

    /*
     * =====================================================
     * PAYMENT CAPTURED
     * =====================================================
     *
     * THIS IS THE ONLY WEBHOOK EVENT THAT CAN DEDUCT STOCK.
     *
     * processCapturedPayment() performs:
     *
     *   stock decrement
     *   payment PAID
     *   order CONFIRMED
     *   cart cleanup
     *
     * atomically.
     */

    if (
      event ===
      "payment.captured"
    ) {
      if (
        typeof razorpayPaymentId !==
        "string"
      ) {
        return res.status(400).json({
          success: false,

          message:
            "Razorpay payment ID missing",
        });
      }

      const result =
        await processCapturedPayment(
          razorpayOrderId,
          razorpayPaymentId,
        );

      return res.status(200).json({
        success: true,

        message:
          result.alreadyProcessed
            ? "Payment already processed"
            : "Payment capture processed",

        data: result,
      });
    }

    return res.status(200).json({
      success: true,

      message:
        "Webhook processed",
    });
  } catch (error) {
    console.error(
      "RAZORPAY WEBHOOK ERROR:",
      error,
    );

    /*
     * 500 causes Razorpay to retry the webhook.
     *
     * This is intentional for genuine processing errors.
     */

    return res.status(500).json({
      success: false,

      message:
        "Webhook processing failed",
    });
  }
}