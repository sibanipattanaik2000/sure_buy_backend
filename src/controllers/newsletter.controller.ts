import type { Request, Response } from "express";
import { z } from "zod";

import {
  subscribeToNewsletter,
} from "../services/newsletter.service";

const subscribeSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Please enter a valid email address")
    .max(254, "Email address is too long"),
});

export async function subscribeNewsletterController(
  req: Request,
  res: Response,
) {
  try {
    const parsed = subscribeSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid email address",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    await subscribeToNewsletter(parsed.data.email);

    return res.status(200).json({
      success: true,
      message: "You're successfully subscribed to PhoneBhai updates.",
    });
  } catch (error) {
    console.error(
      "NEWSLETTER SUBSCRIPTION ERROR:",
      error,
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to subscribe right now. Please try again later.",
    });
  }
}