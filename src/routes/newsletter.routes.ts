import { Router } from "express";

import {
  subscribeNewsletterController,
} from "../controllers/newsletter.controller";

const router = Router();

/**
 * POST /api/v1/newsletter/subscribe
 *
 * Public endpoint.
 */
router.post(
  "/subscribe",
  subscribeNewsletterController,
);

export default router;