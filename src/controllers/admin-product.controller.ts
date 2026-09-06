import type { Request, Response, NextFunction } from "express";
import { ProductCondition } from "@prisma/client";
import {
  createAdminProduct,
  type CreateAdminProductInput,
} from "../services/admin-product.service";

export async function createAdminProductController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const body = req.body as CreateAdminProductInput;

    if (!body || typeof body !== "object") {
      return res.status(400).json({
        success: false,
        message: "Product data is required",
      });
    }

    if (
      !body.slug ||
      !body.brand ||
      !body.name ||
      !body.category ||
      !body.warranty ||
      !body.description
    ) {
      return res.status(400).json({
        success: false,
        message:
          "slug, brand, name, category, warranty and description are required",
      });
    }

    if (!Object.values(ProductCondition).includes(body.condition)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product condition",
      });
    }

    if (!Array.isArray(body.variants) || body.variants.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one product variant is required",
      });
    }

    const product = await createAdminProduct(body);

    return res.status(201).json({
      success: true,
      message: "Product created successfully",
      data: product,
    });
  } catch (error) {
    console.error("CREATE ADMIN PRODUCT ERROR:", error);
    return next(error);
  }
}