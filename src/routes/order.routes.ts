import { Router } from "express";

import { authenticate } from "../middleware/auth.middleware";

import {
  createNewOrder,
  listOrders,
  getSingleOrder,
  cancelExistingOrder,
} from "../controllers/order.controller";

const router = Router();

router.use(authenticate);

// Create order from current cart
router.post("/", createNewOrder);

// Get logged-in user's orders
router.get("/", listOrders);

// Get one order
router.get("/:id", getSingleOrder);

// Cancel an order
router.patch("/:id/cancel", cancelExistingOrder);

export default router;