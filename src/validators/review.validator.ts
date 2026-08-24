import { z } from "zod";

export const createReviewSchema = z.object({
  rating: z
    .number()
    .int()
    .min(1, "Rating must be at least 1")
    .max(5, "Rating cannot exceed 5"),

  comment: z
    .string()
    .trim()
    .min(3, "Review is too short")
    .max(2000, "Review is too long"),
});

export const updateReviewSchema = createReviewSchema.partial();