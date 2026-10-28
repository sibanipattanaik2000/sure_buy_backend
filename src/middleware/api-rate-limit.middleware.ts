import rateLimit from "express-rate-limit";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

import { env } from "../config/env";

const redisUrl = env.UPSTASH_REDIS_REST_URL;
const redisToken = env.UPSTASH_REDIS_REST_TOKEN;

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

let sharedLimiter:
  | Ratelimit
  | undefined;

if (redisUrl && redisToken) {
  sharedLimiter = new Ratelimit({
    redis: new Redis({
      url: redisUrl,
      token: redisToken,
    }),
    limiter: Ratelimit.slidingWindow(300, "15 m"),
    prefix: "phonebhai:api",
    analytics: true,
  });
}

export const apiLimiter = sharedLimiter
  ? async (
      req: import("express").Request,
      res: import("express").Response,
      next: import("express").NextFunction,
    ) => {
      try {
        const identifier =
          req.ip || req.socket.remoteAddress || "unknown";

        const result = await sharedLimiter!.limit(identifier);

        res.setHeader("RateLimit-Limit", result.limit);
        res.setHeader("RateLimit-Remaining", result.remaining);
        res.setHeader(
          "RateLimit-Reset",
          Math.max(
            0,
            Math.ceil((result.reset - Date.now()) / 1000),
          ),
        );

        if (!result.success) {
          return res.status(429).json({
            success: false,
            message: "Too many requests. Please try again later.",
          });
        }

        return next();
      } catch (error) {
        // Fail closed in production rather than silently allowing
        // unlimited requests when the shared limiter is unavailable.
        console.error("SHARED_RATE_LIMITER_ERROR:", error);

        return res.status(503).json({
          success: false,
          message: "Service temporarily unavailable. Please retry shortly.",
        });
      }
    }
  : localLimiter;