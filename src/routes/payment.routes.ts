import { Router } from "express";

import { authenticate } from "../middleware/auth.middleware";

import {
  createPaymentOrder,
  verifyPayment,
  razorpayWebhook,
} from "../controllers/payment.controller";

const router = Router();

/**
 * Razorpay webhook
 *
 * IMPORTANT:
 * This endpoint must NOT use authenticate middleware.
 * Razorpay calls this endpoint directly.
 */
router.post(
  "/webhook",
  razorpayWebhook,
);

/**
 * Customer payment endpoints
 */
router.use(authenticate);

// Create Razorpay order for an existing application order.
router.post(
  "/orders/:orderId",
  createPaymentOrder,
);

// Verify Razorpay Checkout payment.
router.post(
  "/orders/:orderId/verify",
  verifyPayment,
);

export default router;

