import { Router } from "express";

import {
  authenticate,
} from "../middleware/auth.middleware";

import {
  requireAdmin,
} from "../middleware/admin.middleware";

import {
  createAdminProductController,
  getAdminProductsController,
  getAdminProductController,
  updateAdminProductController,
  updateAdminProductStatusController,
  deleteAdminProductController,
} from "../controllers/admin-product.controller";

const router = Router();

/*
 * Every admin product endpoint requires:
 *
 * 1. Valid authentication
 * 2. ADMIN role
 */
router.use(authenticate);
router.use(requireAdmin);

/*
 * IMPORTANT:
 * Keep the static routes BEFORE /:id.
 */

router.get(
  "/",
  getAdminProductsController,
);

router.post(
  "/",
  createAdminProductController,
);

router.get(
  "/:id",
  getAdminProductController,
);

router.patch(
  "/:id/status",
  updateAdminProductStatusController,
);

router.patch(
  "/:id",
  updateAdminProductController,
);

router.delete(
  "/:id",
  deleteAdminProductController,
);

export default router;