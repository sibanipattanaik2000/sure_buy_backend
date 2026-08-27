import { Router } from "express";

import {
  listWishlist,
  addToWishlist,
  removeFromWishlist,
  deleteWishlist,
  checkWishlist,
} from "../controllers/wishlist.controller";

import { authenticate } from "../middleware/auth.middleware";

const router = Router();

router.use(authenticate);

router.get("/", listWishlist);

router.post("/", addToWishlist);

router.delete("/", deleteWishlist);

router.delete("/:productId", removeFromWishlist);

router.get("/:productId/check", checkWishlist);

export default router;