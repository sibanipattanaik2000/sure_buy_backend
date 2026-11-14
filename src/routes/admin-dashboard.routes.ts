import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { requireAdmin } from "../middleware/admin.middleware";

import {
  getAdminAnalytics,
  getAdminPayments,
  searchAdminRecords,
  updateOrderItemImei,
  getAdminCustomers,
} from "../controllers/admin-dashboard.controller";

const router = Router();

router.use(authenticate);
router.use(requireAdmin);

router.get("/analytics", getAdminAnalytics);
router.get("/payments", getAdminPayments);
router.get("/lookup", searchAdminRecords);
router.get("/customers", getAdminCustomers);
router.patch("/orders/:orderId/items/:itemId/imei", updateOrderItemImei);

export default router;
