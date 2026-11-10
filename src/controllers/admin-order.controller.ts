import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../middleware/auth.middleware";

import {
  getAdminOrders,
  recordCashCollection,
} from "../services/admin-order.service";
import {
  confirmManualCashRefund,
  reconcileRazorpayRefund,
  retryFailedRazorpayRefund,
} from "../services/admin-order.service";
function sendAdminOrderError(
  error: unknown,
  res: Response,
  next: NextFunction,
) {
  const message =
    error instanceof Error ? error.message : "Internal server error";

  const statusByError: Record<string, number> = {
    ORDER_NOT_FOUND: 404,
    INVALID_COLLECTION_AMOUNT: 400,
    INVALID_IDEMPOTENCY_KEY: 400,
    CASH_COLLECTION_COD_ONLY: 409,
    ORDER_NOT_COLLECTABLE: 409,
    ORDER_ALREADY_PAID: 409,
    COLLECTION_EXCEEDS_BALANCE: 409,
    COLLECTION_REFERENCE_CONFLICT: 409,
    REFUND_NOT_FOUND: 404,
    MANUAL_CASH_REFUND_ONLY: 409,
    MANUAL_REFUND_NOT_PENDING: 409,
    RAZORPAY_REFUND_ONLY: 409,
    RAZORPAY_PAYMENT_ID_NOT_FOUND: 409,
    REFUND_PROVIDER_DETAILS_MISMATCH: 409,
    REFUND_RECONCILIATION_FAILED: 502,
    REFUND_MUST_BE_CONFIRMED_FAILED: 409,
    ANOTHER_REFUND_IS_PENDING: 409,
    REFUND_EXCEEDS_REMAINING_AMOUNT: 409,
  };

  const status = statusByError[message];

  if (status) {
    return res.status(status).json({
      success: false,
      message,
    });
  }

  console.error("ADMIN ORDER ERROR:", error);
  return next(error);
}

export async function getAdminOrdersController(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 20);
    const search =
      typeof req.query.search === "string"
        ? req.query.search.trim()
        : "";

    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      search.length > 100
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid pagination or search parameters",
      });
    }

    const result = await getAdminOrders({
      page,
      limit,
      search,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return sendAdminOrderError(error, res, next);
  }
}
export async function confirmAdminCashRefundController(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    if (req.body?.confirmed !== true) {
      return res.status(400).json({
        success: false,
        message: "Explicit refund confirmation is required",
      });
    }

    const result = await confirmManualCashRefund({
      orderId: String(req.params.orderId),
      refundId: String(req.params.refundId),
    });

    return res.status(200).json({
      success: true,
      message: "Manual cash refund marked as returned",
      data: result,
    });
  } catch (error) {
    return sendAdminOrderError(error, res, next);
  }
}

export async function reconcileAdminRazorpayRefundController(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const result = await reconcileRazorpayRefund({
      orderId: String(req.params.orderId),
      refundId: String(req.params.refundId),
    });

    return res.status(200).json({
      success: true,
      message:
        result.status === "UNRESOLVED"
          ? "Refund could not yet be matched with Razorpay"
          : "Refund reconciliation completed",
      data: result,
    });
  } catch (error) {
    return sendAdminOrderError(error, res, next);
  }
}

export async function retryAdminRazorpayRefundController(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const idempotencyKey = String(
      req.header("Idempotency-Key") ?? "",
    ).trim();

    const result = await retryFailedRazorpayRefund({
      orderId: String(req.params.orderId),
      refundId: String(req.params.refundId),
      idempotencyKey,
    });

    return res.status(200).json({
      success: true,
      message: "Refund retry submitted",
      data: result,
    });
  } catch (error) {
    return sendAdminOrderError(error, res, next);
  }
}
export async function recordAdminCashCollectionController(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const orderId = String(req.params.orderId ?? "").trim();
    const amount = Number(req.body?.amount);
    const referenceNote =
      typeof req.body?.referenceNote === "string"
        ? req.body.referenceNote.trim()
        : "";

    const idempotencyKey = String(
      req.header("Idempotency-Key") ??
        req.body?.idempotencyKey ??
        "",
    ).trim();

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "Order ID is required",
      });
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "A valid collection amount is required",
      });
    }

    if (referenceNote.length > 250) {
      return res.status(400).json({
        success: false,
        message: "Reference note cannot exceed 250 characters",
      });
    }

    if (
      idempotencyKey.length < 12 ||
      idempotencyKey.length > 100
    ) {
      return res.status(400).json({
        success: false,
        message: "A valid Idempotency-Key is required",
      });
    }

    const result = await recordCashCollection({
      orderId,
      adminUserId: req.userId,
      amount,
      referenceNote,
      idempotencyKey,
    });

    return res.status(200).json({
      success: true,
      message: result.alreadyRecorded
        ? "This cash collection was already recorded"
        : "Cash collection recorded successfully",
      data: result,
    });
  } catch (error) {
    return sendAdminOrderError(error, res, next);
  }
}