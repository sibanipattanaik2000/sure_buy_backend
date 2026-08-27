import { Router } from "express";

import { authenticate } from "../middleware/auth.middleware";

import {
  createPaymentOrder,
  verifyPayment,
} from "../controllers/payment.controller";

const router = Router();

router.use(authenticate);

router.post(
  "/orders/:orderId",
  createPaymentOrder,
);

router.post(
  "/orders/:orderId/verify",
  verifyPayment,
);

export default router;
