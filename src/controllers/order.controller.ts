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
  console.error(`${operation}:`, error);

  if (!(error instanceof Error)) {
    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }

  switch (error.message) {
    case "ADDRESS_NOT_FOUND":
      return res.status(404).json({
        success: false,
        message: "Address not found",
      });

    case "CART_EMPTY":
      return res.status(400).json({
        success: false,
        message: "Your cart is empty",
      });

    case "PRODUCT_UNAVAILABLE":
      return res.status(409).json({
        success: false,
        message: "One or more products are no longer available",
      });

    case "INVALID_CART_QUANTITY":
      return res.status(400).json({
        success: false,
        message: "Invalid cart quantity",
      });

    case "VARIANT_REQUIRED":
      return res.status(400).json({
        success: false,
        message: "A product variant must be selected",
      });

    case "VARIANT_INVALID":
      return res.status(400).json({
        success: false,
        message: "Invalid product variant",
      });

    case "OUT_OF_STOCK":
      return res.status(409).json({
        success: false,
        message: "One or more items are out of stock",
      });

    case "INSUFFICIENT_STOCK":
      return res.status(409).json({
        success: false,
        message: "Requested quantity is not available",
      });

    case "ORDER_NOT_FOUND":
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });

    case "ORDER_CANNOT_BE_CANCELLED":
      return res.status(409).json({
        success: false,
        message: "This order cannot be cancelled",
      });

    case "ORDER_NUMBER_GENERATION_FAILED":
      return res.status(500).json({
        success: false,
        message: "Unable to generate order number",
      });

    default:
      return res.status(500).json({
        success: false,
        message: "Something went wrong",
      });
  }
}

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