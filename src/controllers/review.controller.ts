import type { Response } from "express";
import { ZodError } from "zod";

import type { AuthRequest } from "../middleware/auth.middleware";

import {
  getProductReviews,
  createProductReview,
  updateProductReview,
  deleteProductReview,
} from "../services/review.service";

import {
  createReviewSchema,
  updateReviewSchema,
} from "../validators/review.validator";

export async function listReviews(
  req: AuthRequest,
  res: Response,
) {
  try {
    const productId = Number(req.params.productId);

    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID",
      });
    }

    const page = Math.max(Number(req.query.page) || 1, 1);

    const limit = Math.min(
      Math.max(Number(req.query.limit) || 10, 1),
      50,
    );

    const result = await getProductReviews(
      productId,
      page,
      limit,
    );

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("LIST REVIEWS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch reviews",
    });
  }
}

export async function createReview(
  req: AuthRequest,
  res: Response,
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const productId = Number(req.params.productId);

    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID",
      });
    }

    const input = createReviewSchema.parse(req.body);

    const review = await createProductReview(
      req.userId,
      productId,
      input,
    );

    return res.status(201).json({
      success: true,
      message: "Review created successfully",
      data: review,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({
        success: false,
        message: "Invalid review data",
        errors: error.flatten().fieldErrors,
      });
    }

    if (error instanceof Error) {
      if (error.message === "PRODUCT_NOT_FOUND") {
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }

      if (error.message === "REVIEW_ALREADY_EXISTS") {
        return res.status(409).json({
          success: false,
          message: "You have already reviewed this product",
        });
      }
    }

    console.error("CREATE REVIEW ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create review",
    });
  }
}

export async function updateReview(
  req: AuthRequest,
  res: Response,
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const reviewId = Number(req.params.reviewId);

    if (!Number.isInteger(reviewId) || reviewId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid review ID",
      });
    }

    const input = updateReviewSchema.parse(req.body);

    const review = await updateProductReview(
      req.userId,
      reviewId,
      input,
    );

    return res.status(200).json({
      success: true,
      message: "Review updated successfully",
      data: review,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({
        success: false,
        message: "Invalid review data",
        errors: error.flatten().fieldErrors,
      });
    }

    if (error instanceof Error) {
      if (error.message === "REVIEW_NOT_FOUND") {
        return res.status(404).json({
          success: false,
          message: "Review not found",
        });
      }

      if (error.message === "NOT_REVIEW_OWNER") {
        return res.status(403).json({
          success: false,
          message: "You cannot modify this review",
        });
      }
    }

    console.error("UPDATE REVIEW ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update review",
    });
  }
}

export async function deleteReview(
  req: AuthRequest,
  res: Response,
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const reviewId = Number(req.params.reviewId);

    if (!Number.isInteger(reviewId) || reviewId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid review ID",
      });
    }

    await deleteProductReview(req.userId, reviewId);

    return res.status(200).json({
      success: true,
      message: "Review deleted successfully",
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "REVIEW_NOT_FOUND") {
        return res.status(404).json({
          success: false,
          message: "Review not found",
        });
      }

      if (error.message === "NOT_REVIEW_OWNER") {
        return res.status(403).json({
          success: false,
          message: "You cannot delete this review",
        });
      }
    }

    console.error("DELETE REVIEW ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to delete review",
    });
  }
}