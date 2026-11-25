import type { Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { env } from "../config/env";
import {
  getDeliveryServiceability,
  processShiprocketWebhook,
} from "../services/delivery.service";
import { processShiprocketJobs } from "../services/shiprocket-worker.service";
export async function checkDeliveryServiceability(req: Request, res: Response) {
  const pincode = String(req.query.pincode ?? "").trim();

  const paymentMethod = String(req.query.paymentMethod ?? "PREPAID")
    .trim()
    .toUpperCase();

  if (!/^7[5-7]\d{4}$/.test(pincode)) {
    return res.status(400).json({
      success: false,
      message: "PhoneBhai currently delivers only within Odisha.",
    });
  }

  if (!["COD", "PREPAID"].includes(paymentMethod)) {
    return res.status(400).json({
      success: false,
      message: "Invalid delivery payment method.",
    });
  }

  try {
    const result = await getDeliveryServiceability(
      pincode,
      paymentMethod as "COD" | "PREPAID",
    );
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

export async function receiveDeliveryEvent(req: Request, res: Response) {
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
    expected.length === supplied.length && timingSafeEqual(expected, supplied);

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
export async function runShiprocketWorker(
  req: Request,
  res: Response,
) {
  const expectedToken = env.SHIPROCKET_WORKER_TOKEN;

  if (!expectedToken) {
    return res.status(503).json({
      success: false,
      message: "Shiprocket worker is not configured.",
    });
  }

  const suppliedToken = req.get("x-worker-token") ?? "";

  const expected = Buffer.from(expectedToken);
  const supplied = Buffer.from(suppliedToken);

  const valid =
    expected.length === supplied.length &&
    timingSafeEqual(expected, supplied);

  if (!valid) {
    return res.status(401).json({
      success: false,
      message: "Invalid worker token.",
    });
  }

  try {
    const result = await processShiprocketJobs();

    return res.status(200).json({
      success: true,
      message: "Shiprocket worker executed.",
      data: result,
    });
  } catch (error) {
    console.error(
      "SHIPROCKET WORKER ERROR:",
      error instanceof Error ? error.message : "Unknown error",
    );

    return res.status(500).json({
      success: false,
      message: "Shiprocket worker execution failed.",
    });
  }
}