import type {
  Request,
  Response,
  NextFunction,
} from "express";

import { verifyToken } from "../utils/jwt";

const AUTH_COOKIE_NAME = "phonebhai_access_token";

export interface AuthRequest extends Request {
  userId?: string;
}

export function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const cookieToken =
      req.cookies?.[AUTH_COOKIE_NAME];

    const authHeader =
      req.headers.authorization;

    const bearerToken =
      authHeader?.startsWith("Bearer ")
        ? authHeader.substring(7)
        : undefined;

    const token = cookieToken || bearerToken;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const payload = verifyToken(token);

    req.userId = payload.userId;

    return next();
  } catch (error) {
    console.error("AUTHENTICATION ERROR:", error);

    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
}