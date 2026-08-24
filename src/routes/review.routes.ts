import { Router } from "express";

import {
  listReviews,
  createReview,
  updateReview,
  deleteReview,
} from "../controllers/review.controller";

import { authenticate } from "../middleware/auth.middleware";

const router = Router({ mergeParams: true });

router.get("/", listReviews);

router.post("/", authenticate, createReview);

router.patch("/:reviewId", authenticate, updateReview);

router.delete("/:reviewId", authenticate, deleteReview);

export default router;