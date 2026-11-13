
import type { Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { env } from "../config/env";
import {
  getDeliveryServiceability,
  processShiprocketWebhook,
} from "../services/delivery.service";

export async function checkDeliveryServiceability(
  req: Request,
  res: Response,
) {
  const pincode = String(req.query.pincode ?? "").trim();

  if (!/^\d{6}$/.test(pincode)) {
    return res.status(400).json({
      success: false,
      message: "Please provide a valid 6-digit PIN code.",
    });
  }

  try {
    const result = await getDeliveryServiceability(pincode);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error(
      "DELIVERY SERVICEABILITY ERROR:",
      error instanceof Error ? error.message : "Unknown error",
    );

    return res.status(502).json({
      success: false,
      message:
        "Unable to check delivery availability right now. Please try again.",
    });
  }
}

export async function receiveDeliveryEvent(
  req: Request,
  res: Response,
) {
  const expectedToken = env.SHIPROCKET_WEBHOOK_TOKEN;

  if (!expectedToken) {
    return res.status(503).json({
      success: false,
      message: "Delivery webhook is not configured.",
    });
  }

  const suppliedToken = req.get("x-api-key") ?? "";

  const expected = Buffer.from(expectedToken);
  const supplied = Buffer.from(suppliedToken);

  const valid =
    expected.length === supplied.length &&
    timingSafeEqual(expected, supplied);

  if (!valid) {
    return res.status(401).json({
      success: false,
      message: "Invalid webhook token.",
    });
  }

  try {
    const result = await processShiprocketWebhook(req.body);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error(
      "DELIVERY WEBHOOK PROCESSING ERROR:",
      error instanceof Error ? error.message : "Unknown error",
    );

    return res.status(500).json({
      success: false,
      message: "Unable to process delivery update.",
    });
  }
}
