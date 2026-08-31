import { Router } from "express";

import {
  getSellCatalogController,
  createSellRequestController,
  getSellRequestController,
} from "../controllers/sell.controller";

import { authenticate } from "../middleware/auth.middleware";

const router = Router();

/**
 * Public sell catalogue
 *
 * GET /api/v1/sell/catalog
 */
router.get(
  "/catalog",
  getSellCatalogController,
);

/**
 * Create sell request
 *
 * POST /api/v1/sell/requests
 */
router.post(
  "/requests",
  authenticate,
  createSellRequestController,
);

/**
 * Get authenticated user's sell request
 *
 * GET /api/v1/sell/requests/:sellRequestId
 */
router.get(
  "/requests/:sellRequestId",
  authenticate,
  getSellRequestController,
);

export default router;