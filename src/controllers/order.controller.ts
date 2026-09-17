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
}
  // keep the rest of your existing function exactly as it is
export async function createNewOrder(
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
        message: "Authentication required",
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
        message: "Authentication required",
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
        message: "Authentication required",
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