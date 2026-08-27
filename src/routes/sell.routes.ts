import { Router } from "express";

import {
  getSellCatalogController,
  createSellRequestController,
} from "../controllers/sell.controller";

import { authenticate } from "../middleware/auth.middleware";

const router = Router();

/**
 * Public sell catalogue
 *
 * GET /api/v1/sell/catalog
 */
router.get("/catalog", getSellCatalogController);

/**
 * Authenticated sell operations
 */
router.post(
  "/requests",
  authenticate,
  createSellRequestController,
);

export default router;