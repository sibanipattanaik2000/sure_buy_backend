import { Router } from "express";

import {
  createSellRequestController,
} from "../controllers/sell.controller";

import { authenticate } from "../middleware/auth.middleware";

const router = Router();

router.use(authenticate);

router.post(
  "/requests",
  createSellRequestController,
);

export default router;