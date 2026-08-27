import type { Response } from "express";

import type { AuthRequest } from "../middleware/auth.middleware";

import {
  createRazorpayOrder,
  verifyRazorpayPayment,
} from "../services/payment.service";

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
      switch (error.message) {
        case "ORDER_NOT_FOUND":
          return res.status(404).json({
            success: false,
            message: "Order not found",
          });

        case "ORDER_ALREADY_PAID":
          return res.status(409).json({
            success: false,
            message:
              "Order has already been paid",
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
      message:
        "Unable to create payment order",
    });
  }
}

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
            message:
              "Invalid payment response",
          });

        case "INVALID_PAYMENT_SIGNATURE":
          return res.status(400).json({
            success: false,
            message:
              "Payment signature verification failed",
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
