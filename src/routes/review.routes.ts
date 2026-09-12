import { Router } from "express";
import multer from "multer";

import {
  listReviews,
  createReview,
  updateReview,
  deleteReview,
} from "../controllers/review.controller";

import { authenticate } from "../middleware/auth.middleware";

const router = Router({ mergeParams: true });

const reviewUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 6,
    fileSize: 50 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const isImage = file.mimetype.startsWith("image/");
    const isVideo = file.mimetype.startsWith("video/");

    if (!isImage && !isVideo) {
      return cb(new Error("INVALID_REVIEW_MEDIA_TYPE"));
    }

    cb(null, true);
  },
});

router.get("/", listReviews);

router.post(
  "/",
  authenticate,
  reviewUpload.fields([
    { name: "photos", maxCount: 5 },
    { name: "video", maxCount: 1 },
  ]),
  createReview,
);

router.patch("/:reviewId", authenticate, updateReview);

router.delete("/:reviewId", authenticate, deleteReview);

export default router;