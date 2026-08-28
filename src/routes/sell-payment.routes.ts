
import { Router } from "express";

import { authenticate } from "../middleware/auth.middleware";

import {
  createSellPaymentOrderController,
  verifySellPaymentController,
  getSellPaymentStatusController,
} from "../controllers/sell-payment.controller";

const router = Router();

router.use(authenticate);

/**
 * Create / reuse Razorpay order for sell pickup fee
 *
 * POST /api/v1/sell/payments/:sellRequestId
 */
router.post(
  "/:sellRequestId",
  createSellPaymentOrderController,
);

/**
 * Verify Razorpay payment
 *
 * POST /api/v1/sell/payments/:sellRequestId/verify
 */
router.post(
  "/:sellRequestId/verify",
  verifySellPaymentController,
);

/**
 * Get current sell payment status
 *
 * GET /api/v1/sell/payments/:sellRequestId/status
 */
router.get(
  "/:sellRequestId/status",
  getSellPaymentStatusController,
);

export default router;
