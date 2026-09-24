import type { Response } from "express";
import type { AuthRequest } from "../middleware/auth.middleware";

import {
  createOrder,
  getOrderById,
  getUserOrders,
  cancelOrder,
} from "../services/order.service";

import { createOrderSchema } from "../validators/order.validator";

function handleOrderError(
  error: unknown,
  res: Response,
  operation: string,
) {
  console.error(`[${operation}]`, {
    name: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : error,
    stack: error instanceof Error ? error.stack : undefined,
    code:
      typeof error === "object" &&
      error !== null &&
      "code" in error
        ? (error as { code?: unknown }).code
        : undefined,
    meta:
      typeof error === "object" &&
      error !== null &&
      "meta" in error
        ? (error as { meta?: unknown }).meta
        : undefined,
  });

  const message =
    error instanceof Error
      ? error.message
      : "Internal server error";

  const statusByError: Record<string, number> = {
    ADDRESS_NOT_FOUND: 404,
    CART_EMPTY: 400,
    PRODUCT_UNAVAILABLE: 409,
    INVALID_CART_QUANTITY: 400,
    VARIANT_REQUIRED: 400,
    VARIANT_INVALID: 400,
    OUT_OF_STOCK: 409,
    INSUFFICIENT_STOCK: 409,
    ORDER_NUMBER_GENERATION_FAILED: 500,
    ORDER_NOT_FOUND: 404,
    ORDER_CANNOT_BE_CANCELLED: 409,
  };

  const status = statusByError[message] ?? 500;

  return res.status(status).json({
    success: false,
    message,
  });
}

export async function createNewOrder(
  req: AuthRequest,
  res: Response,
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required, Please login to access this resource",
      });
    }

    const result = createOrderSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid order data",
        errors: result.error.flatten(),
      });
    }

    const order = await createOrder(
      req.userId,
      result.data,
    );

    return res.status(201).json({
      success: true,
      message: "Order created successfully",
      data: order,
    });
  } catch (error) {
    return handleOrderError(
      error,
      res,
      "createNewOrder error",
    );
  }
}

export async function listOrders(
  req: AuthRequest,
  res: Response,
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required, Please login to access this resource",
      });
    }

    const orders = await getUserOrders(req.userId);

    return res.status(200).json({
      success: true,
      data: orders,
    });
  } catch (error) {
    return handleOrderError(
      error,
      res,
      "listOrders error",
    );
  }
}

export async function getSingleOrder(
  req: AuthRequest,
  res: Response,
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required, Please login to access this resource",
      });
    }

    const orderId = String(req.params.id);

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "Order ID is required",
      });
    }

    const order = await getOrderById(
      req.userId,
      orderId,
    );

    return res.status(200).json({
      success: true,
      data: order,
    });
  } catch (error) {
    return handleOrderError(
      error,
      res,
      "getSingleOrder error",
    );
  }
}

export async function cancelExistingOrder(
  req: AuthRequest,
  res: Response,
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required, Please login to access this resource",
      });
    }

    const orderId = String(req.params.id);

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "Order ID is required",
      });
    }

    const order = await cancelOrder(
      req.userId,
      orderId,
    );

    return res.status(200).json({
      success: true,
      message: "Order cancelled successfully",
      data: order,
    });
  } catch (error) {
    return handleOrderError(
      error,
      res,
      "cancelExistingOrder error",
    );
  }
}