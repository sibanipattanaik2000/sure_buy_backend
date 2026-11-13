import { Router } from "express";

import { authenticate } from "../middleware/auth.middleware";
import { requireAdmin } from "../middleware/admin.middleware";
import {
  confirmAdminCashRefundController,
  reconcileAdminRazorpayRefundController,
  retryAdminRazorpayRefundController,
} from "../controllers/admin-order.controller";

import {
  getAdminOrdersController,
  recordAdminCashCollectionController,
  createAdminShiprocketShipmentController,
} from "../controllers/admin-order.controller";

const router = Router();

// Every endpoint requires a valid logged-in ADMIN.
router.use(authenticate);
router.use(requireAdmin);

router.get("/", getAdminOrdersController);

router.post(
  "/:orderId/cash-collection",
  recordAdminCashCollectionController,
);
router.post(
  "/:orderId/cash-refunds/:refundId/confirm",
  confirmAdminCashRefundController,
);

router.post(
  "/:orderId/refunds/:refundId/reconcile",
  reconcileAdminRazorpayRefundController,
);

router.post(
  "/:orderId/refunds/:refundId/retry",
  retryAdminRazorpayRefundController,
);
router.post(
  "/:orderId/shiprocket",
  createAdminShiprocketShipmentController,
);
export default router;