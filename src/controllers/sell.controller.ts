import type { Response } from "express";
import { z } from "zod";

import type { AuthRequest } from "../middleware/auth.middleware";
import { createSellRequest } from "../services/sell.service";

const mediaSchema = z.object({
  url: z.string().url(),
  key: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().int().positive(),
  position: z.number().int().min(0),
});

const createSellRequestSchema = z.object({
  productId: z.number().int().positive(),

  workingStatus: z.string().trim().min(1).max(100),
  screenCondition: z.string().trim().min(1).max(100),
  deviceCondition: z.string().trim().min(1).max(100),
  batteryCondition: z.string().trim().min(1).max(100),

  pickupAddress: z.string().trim().min(10).max(1000),

  pickupDate: z.string().datetime(),

  pickupSlot: z
    .string()
    .trim()
    .min(1)
    .max(100),

  media: z
    .array(mediaSchema)
    .max(5)
    .optional()
    .default([]),
});

export async function createSellRequestController(
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

    const parsed = createSellRequestSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid sell request",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const result = await createSellRequest({
      userId: req.userId,
      ...parsed.data,
      pickupDate: new Date(parsed.data.pickupDate),
    });

    return res.status(201).json({
      success: true,
      message: "Sell request submitted successfully",
      data: result,
    });
  } catch (error) {
    console.error("CREATE SELL REQUEST ERROR:", error);

    if (
      error instanceof Error &&
      error.message === "PRODUCT_NOT_FOUND"
    ) {
      return res.status(404).json({
        success: false,
        message: "Selected phone is no longer available",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to submit sell request",
    });
  }
}