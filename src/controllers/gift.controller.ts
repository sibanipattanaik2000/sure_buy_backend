import type { Request, Response } from "express";
import type { AuthRequest } from "../middleware/auth.middleware";
import crypto from "crypto";
import {
  startGiftOffer,
  getMyGiftCards,
  claimGift,
  listAdminGiftCards,
  updateAdminGiftCard,
} from "../services/gift.service";

export async function startGiftOfferController(req: Request, res: Response) {
  try {
    const productId = Number(req.body?.productId);
    const userId = (req as AuthRequest).userId ?? null;

    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Valid productId is required",
      });
    }

    // Persistent anonymous visitor identity.
    let visitorId = req.cookies?.pb_gift_visitor as string | undefined;

    if (!visitorId || !/^[a-f0-9]{64}$/i.test(visitorId)) {
      visitorId = crypto.randomBytes(32).toString("hex");

      res.cookie("pb_gift_visitor", visitorId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });
    }

    const data = await startGiftOffer(
      userId,
      visitorId,
      productId,
    );

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to start gift offer";

    return res.status(
      message === "PRODUCT_UNAVAILABLE" ? 404 : 500,
    ).json({
      success: false,
      message,
    });
  }
}

export async function myGiftCardsController(req: AuthRequest, res: Response) {
  if (!req.userId) {
    return res.status(401).json({
      success: false,
      message: "Login required",
    });
  }

  const data = await getMyGiftCards(req.userId);

  return res.json({
    success: true,
    data,
  });
}

export async function claimGiftController(req: AuthRequest, res: Response) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: "Login required",
      });
    }

    const code = String(req.body?.code || "")
      .trim()
      .toUpperCase();

    const giftName = String(req.body?.giftName || "");

    const data = await claimGift(req.userId, code, giftName);

    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Gift claim failed";

    const status = message === "INVALID_GIFT_SELECTION" ? 400 : 409;

    return res.status(status).json({
      success: false,
      message,
    });
  }
}

export async function adminGiftCardsController(_req: Request, res: Response) {
  const data = await listAdminGiftCards();

  return res.json({
    success: true,
    data,
  });
}

export async function adminUpdateGiftCardController(
  req: Request,
  res: Response,
) {
  try {
    const status = String(req.body?.status) as
      | "APPROVED"
      | "DISPATCHED"
      | "FULFILLED"
      | "CANCELLED";

    if (
      !["APPROVED", "DISPATCHED", "FULFILLED", "CANCELLED"].includes(status)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid gift status",
      });
    }

    const data = await updateAdminGiftCard(
      String(req.params.id),
      status,
      req.body?.adminNote,
    );

    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Gift update failed";

    return res.status(409).json({
      success: false,
      message,
    });
  }
}
