import type { Response } from "express";
import { z } from "zod";
import type { AuthRequest } from "../middleware/auth.middleware";

import {
  createSellPaymentOrder,
  verifySellPayment,
  getSellPaymentStatus,
} from "../services/sell-payment.service";

const createPaymentSchema = z.object({
  method: z.enum(["UPI", "CARD"]),
});

const verifyPaymentSchema = z.object({
  razorpayPaymentId: z.string().min(1),
  razorpayOrderId: z.string().min(1),
  razorpaySignature: z.string().min(1),
});

/**
 * POST /api/v1/sell/payments/:sellRequestId
 *
 * Creates or reuses the Razorpay order for the ₹500
 * sell pickup booking fee.
 */
export async function createSellPaymentOrderController(
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

    const { sellRequestId } = req.params;

    if (typeof sellRequestId !== "string") {
      return res.status(400).json({
        success: false,
        message: "Invalid sell request ID",
      });
    }

    const parsed = createPaymentSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment method",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const result = await createSellPaymentOrder(
      req.userId,
      sellRequestId,
      parsed.data.method,
    );

    return res.status(200).json({
      success: true,
      message: "Sell payment order ready",
      data: result,
    });
  } catch (error) {
    console.error("CREATE SELL PAYMENT ORDER ERROR:", error);

    if (!(error instanceof Error)) {
      return res.status(500).json({
        success: false,
        message: "Unable to create sell payment",
      });
    }

    switch (error.message) {
      case "SELL_REQUEST_NOT_FOUND":
        return res.status(404).json({
          success: false,
          message: "Sell request not found",
        });

      case "SELL_REQUEST_NOT_PAYABLE":
        return res.status(409).json({
          success: false,
          message: "This sell request is not eligible for payment",
        });

      case "SELL_PAYMENT_ALREADY_PAID":
        return res.status(409).json({
          success: false,
          message: "This sell request has already been paid",
        });

      default:
        return res.status(500).json({
          success: false,
          message: "Unable to create sell payment",
        });
    }
  }
}

/**
 * POST /api/v1/sell/payments/:sellRequestId/verify
 *
 * Verifies Razorpay Checkout payment on the server.
 */
export async function verifySellPaymentController(
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

    const { sellRequestId } = req.params;

    if (typeof sellRequestId !== "string") {
      return res.status(400).json({
        success: false,
        message: "Invalid sell request ID",
      });
    }

    const parsed = verifyPaymentSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid Razorpay payment response",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const result = await verifySellPayment(
      req.userId,
      sellRequestId,
      parsed.data.razorpayPaymentId,
      parsed.data.razorpayOrderId,
      parsed.data.razorpaySignature,
    );

    return res.status(200).json({
      success: true,
      message: result.alreadyProcessed
        ? "Sell payment already verified"
        : "Sell payment verified successfully",
      data: result,
    });
  } catch (error) {
    console.error("VERIFY SELL PAYMENT ERROR:", error);

    if (!(error instanceof Error)) {
      return res.status(500).json({
        success: false,
        message: "Payment verification failed",
      });
    }

    const clientErrors = new Set([
      "INVALID_PAYMENT_RESPONSE",
      "SELL_REQUEST_NOT_FOUND",
      "SELL_PAYMENT_NOT_FOUND",
      "PAYMENT_REQUEST_MISMATCH",
      "PAYMENT_CURRENCY_MISMATCH",
      "INVALID_PAYMENT_SIGNATURE",
      "PAYMENT_ORDER_MISMATCH",
      "PAYMENT_AMOUNT_MISMATCH",
      "PAYMENT_NOT_CAPTURED",
    ]);

    if (clientErrors.has(error.message)) {
      return res.status(400).json({
        success: false,
        message: getSellPaymentErrorMessage(error.message),
        code: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Payment verification failed",
    });
  }
}

/**
 * GET /api/v1/sell/payments/:sellRequestId/status
 *
 * Returns the current sell request/payment state.
 */
export async function getSellPaymentStatusController(
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

    const { sellRequestId } = req.params;

    if (typeof sellRequestId !== "string") {
      return res.status(400).json({
        success: false,
        message: "Invalid sell request ID",
      });
    }

    const result = await getSellPaymentStatus(req.userId, sellRequestId);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("GET SELL PAYMENT STATUS ERROR:", error);

    if (error instanceof Error && error.message === "SELL_REQUEST_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        message: "Sell request not found",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Unable to fetch sell payment status",
    });
  }
}

function getSellPaymentErrorMessage(code: string): string {
  switch (code) {
    case "INVALID_PAYMENT_RESPONSE":
      return "Invalid payment response received.";

    case "SELL_REQUEST_NOT_FOUND":
      return "Sell request not found.";

    case "SELL_PAYMENT_NOT_FOUND":
      return "Sell payment record not found.";

    case "PAYMENT_REQUEST_MISMATCH":
      return "Payment does not belong to this sell request.";

    case "PAYMENT_CURRENCY_MISMATCH":
      return "Payment currency mismatch.";

    case "INVALID_PAYMENT_SIGNATURE":
      return "Payment signature verification failed.";

    case "PAYMENT_ORDER_MISMATCH":
      return "Payment order mismatch.";

    case "PAYMENT_AMOUNT_MISMATCH":
      return "Payment amount mismatch.";

    case "PAYMENT_NOT_CAPTURED":
      return "Payment has not been captured yet.";

    default:
      return "Payment verification failed.";
  }
}
