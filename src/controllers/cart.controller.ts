import type { Response } from "express";
import type { AuthRequest } from "../middleware/auth.middleware";

import {
  addCartItemSchema,
  updateCartItemSchema,
} from "../validators/cart.validator";

import {
  getUserCart,
  addItemToCart,
  updateCartItem,
  removeCartItem,
  clearUserCart,
  validateUserCart,
} from "../services/cart.service";

function handleCartError(
  error: unknown,
  res: Response,
  operation: string,
) {
  console.error(`${operation}:`, error);

  if (!(error instanceof Error)) {
    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }

  switch (error.message) {
    case "PRODUCT_NOT_FOUND":
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });

    case "VARIANT_NOT_FOUND":
      return res.status(404).json({
        success: false,
        message: "Product variant not found",
      });

    case "VARIANT_REQUIRED":
      return res.status(400).json({
        success: false,
        message: "A product variant must be selected",
      });

    case "VARIANT_OUT_OF_STOCK":
      return res.status(409).json({
        success: false,
        message: "Selected variant is out of stock",
      });

    case "INSUFFICIENT_STOCK":
      return res.status(409).json({
        success: false,
        message: "Requested quantity is not available",
      });

    case "CART_ITEM_NOT_FOUND":
      return res.status(404).json({
        success: false,
        message: "Cart item not found",
      });

    case "PRODUCT_UNAVAILABLE":
      return res.status(409).json({
        success: false,
        message: "This product is no longer available",
      });

    default:
      return res.status(500).json({
        success: false,
        message: "Something went wrong",
      });
  }
}

export async function getCart(
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

    const cart = await getUserCart(req.userId);

    return res.status(200).json({
      success: true,
      data: cart,
    });
  } catch (error) {
    return handleCartError(
      error,
      res,
      "getCart error",
    );
  }
}

export async function addCartItem(
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

    const result = addCartItemSchema.safeParse(
      req.body,
    );

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid cart item data",
        errors: result.error.flatten(),
      });
    }

    const cart = await addItemToCart(
      req.userId,
      result.data,
    );

    return res.status(201).json({
      success: true,
      message: "Item added to cart",
      data: cart,
    });
  } catch (error) {
    return handleCartError(
      error,
      res,
      "addCartItem error",
    );
  }
}

export async function editCartItem(
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

    const itemId = String(req.params.itemId);

    if (!itemId) {
      return res.status(400).json({
        success: false,
        message: "Cart item ID is required",
      });
    }

    const result = updateCartItemSchema.safeParse(
      req.body,
    );

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid cart item data",
        errors: result.error.flatten(),
      });
    }

    const cart = await updateCartItem(
      req.userId,
      itemId,
      result.data,
    );

    return res.status(200).json({
      success: true,
      message: "Cart item updated",
      data: cart,
    });
  } catch (error) {
    return handleCartError(
      error,
      res,
      "editCartItem error",
    );
  }
}

export async function deleteCartItem(
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

    const itemId = String(req.params.itemId);

    if (!itemId) {
      return res.status(400).json({
        success: false,
        message: "Cart item ID is required",
      });
    }

    const cart = await removeCartItem(
      req.userId,
      itemId,
    );

    return res.status(200).json({
      success: true,
      message: "Item removed from cart",
      data: cart,
    });
  } catch (error) {
    return handleCartError(
      error,
      res,
      "deleteCartItem error",
    );
  }
}

export async function clearCart(
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

    const cart = await clearUserCart(
      req.userId,
    );

    return res.status(200).json({
      success: true,
      message: "Cart cleared successfully",
      data: cart,
    });
  } catch (error) {
    return handleCartError(
      error,
      res,
      "clearCart error",
    );
  }
}

export async function validateCart(
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

    const result = await validateUserCart(
      req.userId,
    );

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return handleCartError(
      error,
      res,
      "validateCart error",
    );
  }
}