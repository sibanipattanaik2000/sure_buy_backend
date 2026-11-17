import rateLimit from "express-rate-limit";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

import { env } from "../config/env";

const redisUrl = env.UPSTASH_REDIS_REST_URL;
const redisToken = env.UPSTASH_REDIS_REST_TOKEN;

/**
 * Local limiter:
 * Used for public, read-only product endpoints.
 *
 * This avoids a remote Upstash request for every product read.
 * The limit is per running application instance.
 */
const localLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests. Please try again later.",
  },
});

let sharedLimiter: Ratelimit | undefined;

if (redisUrl && redisToken) {
  sharedLimiter = new Ratelimit({
    redis: new Redis({
      url: redisUrl,
      token: redisToken,
    }),
    limiter: Ratelimit.slidingWindow(300, "15 m"),
    prefix: "phonebhai:api",
  });
}

/**
 * Only these GET endpoints bypass the shared Upstash limiter:
 *
 * GET /api/v1/products
 * GET /api/v1/products/:identifier
 * GET /api/v1/products/:productId/reviews
 *
 * All product writes and other API operations remain protected.
 */
function isPublicProductRead(req: import("express").Request): boolean {
  if (req.method !== "GET") {
    return false;
  }

  const pathname = (req.originalUrl.split("?")[0] ?? "").replace(/\/+$/, "");

  const prefix = "/api/v1/products";

  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) {
    return false;
  }

  const segments = pathname.slice(prefix.length).split("/").filter(Boolean);

  // Product listing
  if (segments.length === 0) {
    return true;
  }

  // Product details
  if (segments.length === 1) {
    return true;
  }

  // Public review listing only
  if (segments.length === 2 && segments[1] === "reviews") {
    return true;
  }

  return false;
}

export const apiLimiter = async (
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
) => {
  // Public product reads use local rate limiting instead of Redis.
  if (isPublicProductRead(req)) {
    return localLimiter(req, res, next);
  }

  // Preserve the existing local fallback if Upstash is not configured.
  if (!sharedLimiter) {
    return localLimiter(req, res, next);
  }

  // All other API operations retain shared Redis protection.
  try {
    const identifier = req.ip || req.socket.remoteAddress || "unknown";

    const result = await sharedLimiter.limit(identifier);

    res.setHeader("RateLimit-Limit", result.limit);
    res.setHeader("RateLimit-Remaining", result.remaining);
    res.setHeader(
      "RateLimit-Reset",
      Math.max(0, Math.ceil((result.reset - Date.now()) / 1000)),
    );

    if (!result.success) {
      return res.status(429).json({
        success: false,
        message: "Too many requests. Please try again later.",
      });
    }

    return next();
  } catch (error) {
    // Keep sensitive operations protected if Redis is unavailable.
    console.error("SHARED_RATE_LIMITER_ERROR:", error);

    return res.status(503).json({
      success: false,
      message: "Service temporarily unavailable. Please retry shortly.",
    });
  }
};
