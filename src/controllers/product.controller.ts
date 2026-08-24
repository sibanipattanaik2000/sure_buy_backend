import { Request, Response } from "express";
import {
  getProducts,
  GetProductsParams,
  getProductByIdentifier as getProductByIdentifierService,
} from "../services/product.service";

export async function listProducts(req: Request, res: Response) {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);

    const condition =
      typeof req.query.condition === "string" ? req.query.condition : undefined;

    const allowedConditions = ["EXCELLENT", "LIKE_NEW", "GOOD"] as const;

    const validCondition = allowedConditions.includes(
      condition as (typeof allowedConditions)[number],
    )
      ? (condition as GetProductsParams["condition"])
      : undefined;

    const result = await getProducts({
      page,
      limit,
      search:
        typeof req.query.search === "string" ? req.query.search : undefined,
      category:
        typeof req.query.category === "string" ? req.query.category : undefined,
      brand: typeof req.query.brand === "string" ? req.query.brand : undefined,
      condition: validCondition,
      minPrice:
        req.query.minPrice !== undefined
          ? Number(req.query.minPrice)
          : undefined,
      maxPrice:
        req.query.maxPrice !== undefined
          ? Number(req.query.maxPrice)
          : undefined,
      sort:
        typeof req.query.sort === "string"
          ? (req.query.sort as GetProductsParams["sort"])
          : undefined,
    });

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("List products error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch products",
    });
  }
}

export async function getProductByIdentifier(req: Request, res: Response) {
  try {
    const { identifier } = req.params;

    if (!identifier || typeof identifier !== "string") {
      return res.status(400).json({
        success: false,
        message: "Product ID or slug is required",
      });
    }

    const product = await getProductByIdentifierService(identifier);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: product,
    });
  } catch (error) {
    console.error("GET PRODUCT ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch product",
    });
  }
}
