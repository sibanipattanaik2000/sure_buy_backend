import type { Request, Response, NextFunction } from "express";

import { ProductCondition } from "@prisma/client";

import {
  createAdminProduct,
  getAdminProducts,
  getAdminProduct,
  updateAdminProduct,
  updateAdminProductStatus,
  deleteAdminProduct,
  type CreateAdminProductInput,
  type UpdateAdminProductInput,
} from "../services/admin-product.service";

/* =========================================================
 * HELPERS
 * ========================================================= */

function parseProductId(value: string | string[] | undefined): number {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Invalid product id");
  }

  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Invalid product id");
  }

  return id;
}

function getErrorCode(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }

  return undefined;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Unable to process product request";
}

/* =========================================================
 * CREATE PRODUCT
 * ========================================================= */

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

/* =========================================================
 * GET ALL ADMIN PRODUCTS
 * ========================================================= */

export async function getAdminProductsController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const page = Number(req.query.page ?? 1);

    const limit = Number(req.query.limit ?? 20);

    const search = typeof req.query.search === "string" ? req.query.search : "";

    const includeInactive = req.query.includeInactive !== "false";

    const result = await getAdminProducts({
      page,
      limit,
      search,
      includeInactive,
    });

    return res.status(200).json({
      success: true,
      data: {
        products: result.products,
        pagination: result.pagination,
      },
    });
  } catch (error) {
    console.error("GET ADMIN PRODUCTS ERROR:", error);

    return next(error);
  }
}

/* =========================================================
 * GET SINGLE ADMIN PRODUCT
 * ========================================================= */

export async function getAdminProductController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const productId = parseProductId(req.params.id);

    if (!productId) {
      return res.status(400).json({
        success: false,
        message: "Invalid product id",
      });
    }

    const product = await getAdminProduct(productId);

    return res.status(200).json({
      success: true,
      data: product,
    });
  } catch (error) {
    const code = getErrorCode(error);

    if (code === "PRODUCT_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        message: getErrorMessage(error),
      });
    }

    console.error("GET ADMIN PRODUCT ERROR:", error);

    return next(error);
  }
}

/* =========================================================
 * UPDATE ADMIN PRODUCT
 * ========================================================= */

export async function updateAdminProductController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const productId = parseProductId(req.params.id);

    if (!productId) {
      return res.status(400).json({
        success: false,
        message: "Invalid product id",
      });
    }

    const body = req.body as UpdateAdminProductInput;

    if (!Object.values(ProductCondition).includes(body.condition)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product condition",
      });
    }

    const product = await updateAdminProduct(productId, body);

    return res.status(200).json({
      success: true,
      message: "Product updated successfully",
      data: product,
    });
  } catch (error) {
    const code = getErrorCode(error);

    if (code === "PRODUCT_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        message: getErrorMessage(error),
      });
    }

    if (code === "DUPLICATE_SLUG") {
      return res.status(409).json({
        success: false,
        message: getErrorMessage(error),
      });
    }

    if (code === "INVALID_PRODUCT_DATA" || code === "INVALID_STATUS") {
      return res.status(400).json({
        success: false,
        message: getErrorMessage(error),
      });
    }

    console.error("UPDATE ADMIN PRODUCT ERROR:", error);

    return next(error);
  }
}

/* =========================================================
 * ACTIVATE / DEACTIVATE
 * ========================================================= */

export async function updateAdminProductStatusController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const productId = parseProductId(req.params.id);

    if (!productId) {
      return res.status(400).json({
        success: false,
        message: "Invalid product id",
      });
    }

    const { active } = req.body as {
      active?: unknown;
    };

    if (typeof active !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "active must be a boolean",
      });
    }

    const product = await updateAdminProductStatus(productId, active);

    return res.status(200).json({
      success: true,
      message: active
        ? "Product activated successfully"
        : "Product deactivated successfully",
      data: product,
    });
  } catch (error) {
    const code = getErrorCode(error);

    if (code === "PRODUCT_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        message: getErrorMessage(error),
      });
    }

    return next(error);
  }
}

/* =========================================================
 * HARD DELETE
 * ========================================================= */

export async function deleteAdminProductController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const productId = parseProductId(req.params.id);

    if (!productId) {
      return res.status(400).json({
        success: false,
        message: "Invalid product id",
      });
    }

    const deleted = await deleteAdminProduct(productId);

    return res.status(200).json({
      success: true,
      message: "Product deleted permanently",
      data: deleted,
    });
  } catch (error) {
    const code = getErrorCode(error);

    if (code === "PRODUCT_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        message: getErrorMessage(error),
      });
    }

    if (code === "PRODUCT_DELETE_BLOCKED") {
      return res.status(409).json({
        success: false,
        message: getErrorMessage(error),
      });
    }

    console.error("DELETE ADMIN PRODUCT ERROR:", error);

    return next(error);
  }
}
