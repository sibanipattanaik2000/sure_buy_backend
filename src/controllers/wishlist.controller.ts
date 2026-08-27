import type { Response } from "express";
import type { AuthRequest } from "../middleware/auth.middleware";

import {
  getWishlist,
  addWishlistItem,
  removeWishlistItem,
  clearWishlist,
  isProductWishlisted,
} from "../services/wishlist.service";

function parseProductId(value: unknown): number | null {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  return id;
}

export async function listWishlist(
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

    const wishlist = await getWishlist(req.userId);

    return res.status(200).json({
      success: true,
      data: wishlist,
    });
  } catch (error) {
    console.error("LIST WISHLIST ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch wishlist",
    });
  }
}

export async function addToWishlist(
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

    const productId = parseProductId(
      req.body?.productId,
    );

    if (!productId) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID",
      });
    }

    const item = await addWishlistItem(
      req.userId,
      productId,
    );

    return res.status(201).json({
      success: true,
      message: "Product added to wishlist",
      data: item,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "PRODUCT_NOT_FOUND"
    ) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    console.error("ADD WISHLIST ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to add product to wishlist",
    });
  }
}

export async function removeFromWishlist(
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

    const productId = parseProductId(
      req.params.productId,
    );

    if (!productId) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID",
      });
    }

    await removeWishlistItem(
      req.userId,
      productId,
    );

    return res.status(200).json({
      success: true,
      message: "Product removed from wishlist",
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "WISHLIST_ITEM_NOT_FOUND"
    ) {
      return res.status(404).json({
        success: false,
        message: "Product is not in wishlist",
      });
    }

    console.error("REMOVE WISHLIST ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to remove product from wishlist",
    });
  }
}

export async function deleteWishlist(
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

    await clearWishlist(req.userId);

    return res.status(200).json({
      success: true,
      message: "Wishlist cleared successfully",
    });
  } catch (error) {
    console.error("CLEAR WISHLIST ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to clear wishlist",
    });
  }
}

export async function checkWishlist(
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

    const productId = parseProductId(
      req.params.productId,
    );

    if (!productId) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID",
      });
    }

    const wishlisted = await isProductWishlisted(
      req.userId,
      productId,
    );

    return res.status(200).json({
      success: true,
      data: {
        productId,
        wishlisted,
      },
    });
  } catch (error) {
    console.error("CHECK WISHLIST ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to check wishlist",
    });
  }
}