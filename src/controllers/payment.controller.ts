import type { Request, Response } from "express";
import crypto from "crypto";

import { env } from "../config/env";
import { prisma } from "../config/prisma";

import {
  PaymentStatus,
  OrderStatus,
} from "@prisma/client";

import type { AuthRequest } from "../middleware/auth.middleware";

import {
  createRazorpayOrder,
  verifyRazorpayPayment,
} from "../services/payment.service";

/**
 * Create Razorpay payment order
 *
 * POST /api/v1/payments/orders/:orderId
 */
export async function createPaymentOrder(
  req: AuthRequest,
  res: Response,
) {
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

    const payment = await createRazorpayOrder(
      req.userId,
      orderId,
    );

    return res.status(201).json({
      success: true,
      message: "Razorpay order created successfully",
      data: payment,
    });
  } catch (error) {
    console.error(
      "CREATE PAYMENT ORDER ERROR:",
      error,
    );

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

        case "COD_ORDER_CANNOT_USE_RAZORPAY":
          return res.status(400).json({
            success: false,
            message:
              "Cash on Delivery orders do not require online payment",
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
 * Verify Razorpay Checkout payment
 *
 * POST /api/v1/payments/orders/:orderId/verify
 */
export async function verifyPayment(
  req: AuthRequest,
  res: Response,
) {
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

    return res.status(200).json({
      success: true,
      message: "Payment verified successfully",
      data: result,
    });
  } catch (error) {
    console.error(
      "VERIFY PAYMENT ERROR:",
      error,
    );

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
      }
    }

    return res.status(500).json({
      success: false,
      message: "Unable to verify payment",
    });
  }
}

/**
 * Razorpay webhook
 *
 * POST /api/v1/payments/webhook
 *
 * This endpoint is intentionally NOT authenticated
 * with our JWT middleware.
 *
 * Razorpay authenticates the request using:
 *
 * x-razorpay-signature
 */
export async function razorpayWebhook(
  req: Request,
  res: Response,
) {
  try {
    const signature =
      req.headers["x-razorpay-signature"];

    if (typeof signature !== "string") {
      return res.status(400).json({
        success: false,
        message:
          "Missing Razorpay webhook signature",
      });
    }

    /**
     * Razorpay signs the exact raw request body.
     */
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

    const expectedSignature =
      crypto
        .createHmac(
          "sha256",
          env.RAZORPAY_WEBHOOK_SECRET,
        )
        .update(req.rawBody)
        .digest("hex");

    const signatureBuffer =
      Buffer.from(signature);

    const expectedBuffer =
      Buffer.from(expectedSignature);

    if (
      signatureBuffer.length !==
      expectedBuffer.length
    ) {
      console.warn(
        "Invalid Razorpay webhook signature",
      );

      return res.status(401).json({
        success: false,
        message:
          "Invalid webhook signature",
      });
    }

    const signaturesMatch =
      crypto.timingSafeEqual(
        signatureBuffer,
        expectedBuffer,
      );

    if (!signaturesMatch) {
      console.warn(
        "Invalid Razorpay webhook signature",
      );

      return res.status(401).json({
        success: false,
        message:
          "Invalid webhook signature",
      });
    }

    const event = req.body?.event;

    const paymentEntity =
      req.body?.payload?.payment?.entity;

    const razorpayOrderId =
      paymentEntity?.order_id;

    const razorpayPaymentId =
      paymentEntity?.id;

    if (typeof event !== "string") {
      return res.status(400).json({
        success: false,
        message:
          "Invalid Razorpay webhook event",
      });
    }

    /**
     * Ignore unrelated Razorpay events.
     */
    if (
      event !== "payment.authorized" &&
      event !== "payment.captured" &&
      event !== "payment.failed"
    ) {
      return res.status(200).json({
        success: true,
        message: "Webhook acknowledged",
      });
    }

    if (
      typeof razorpayOrderId !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Razorpay order ID missing",
      });
    }

    /**
     * Only process payment records that were
     * created by our own application.
     */
    const payment =
      await prisma.payment.findUnique({
        where: {
          providerOrderId:
            razorpayOrderId,
        },
      });

    if (!payment) {
      console.warn(
        "Razorpay webhook payment not found:",
        razorpayOrderId,
      );

      /**
       * Unknown provider orders are acknowledged
       * so Razorpay does not continuously retry them.
       */
      return res.status(200).json({
        success: true,
        message: "Webhook acknowledged",
      });
    }

    /**
     * ============================================================
     * PAYMENT FAILED
     * ============================================================
     *
     * Only update the payment record here.
     *
     * Stock is NOT released from the payment webhook.
     *
     * This prevents webhook retries/races from accidentally
     * incrementing product stock multiple times.
     */
    if (event === "payment.failed") {
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

          /**
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
                typeof paymentEntity?.error_code ===
                "string"
                  ? paymentEntity.error_code
                  : null,

              failureMessage:
                typeof paymentEntity?.error_description ===
                "string"
                  ? paymentEntity.error_description
                  : null,
            },
          });
        },
        {
          isolationLevel:
            "Serializable",
        },
      );

      return res.status(200).json({
        success: true,
        message:
          "Payment failure processed",
      });
    }

    /**
     * ============================================================
     * PAYMENT AUTHORIZED / CAPTURED
     * ============================================================
     */
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

        /**
         * Never downgrade PAID or REFUNDED.
         */
        if (
          currentPayment.status ===
            PaymentStatus.PAID ||
          currentPayment.status ===
            PaymentStatus.REFUNDED
        ) {
          return;
        }

        const isCaptured =
          event ===
          "payment.captured";

        await tx.payment.update({
          where: {
            id: payment.id,
          },

          data: {
            status: isCaptured
              ? PaymentStatus.PAID
              : PaymentStatus.AUTHORIZED,

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
              isCaptured
                ? PaymentStatus.PAID
                : PaymentStatus.AUTHORIZED,

            /**
             * The order becomes confirmed only
             * after payment capture.
             */
            status: isCaptured
              ? OrderStatus.CONFIRMED
              : undefined,
          },
        });
      },
      {
        isolationLevel:
          "Serializable",
      },
    );

    return res.status(200).json({
      success: true,
      message:
        "Payment webhook processed",
    });
  } catch (error) {
    console.error(
      "RAZORPAY WEBHOOK ERROR:",
      error,
    );

    /**
     * HTTP 500 tells Razorpay to retry the webhook.
     */
    return res.status(500).json({
      success: false,
      message:
        "Webhook processing failed",
    });
  }
}