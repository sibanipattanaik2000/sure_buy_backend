import { Router } from "express";

import { authenticate } from "../middleware/auth.middleware";

import {
  getCart,
  addCartItem,
  editCartItem,
  deleteCartItem,
  clearCart,
  validateCart,
} from "../controllers/cart.controller";

const router = Router();

router.use(authenticate);

router.get("/", getCart);

router.post("/items", addCartItem);

router.patch(
  "/items/:itemId",
  editCartItem,
);

router.delete(
  "/items/:itemId",
  deleteCartItem,
);

router.delete("/", clearCart);

router.post("/validate", validateCart);

export default router;