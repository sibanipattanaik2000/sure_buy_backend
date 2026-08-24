import type { Response, NextFunction } from "express";
import { UserRole } from "@prisma/client";

import { prisma } from "../config/prisma";
import type { AuthRequest } from "./auth.middleware";

export async function requireAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const user = await prisma.user.findUnique({
      where: {
        id: req.userId,
      },
      select: {
        role: true,
      },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.role !== UserRole.ADMIN) {
      return res.status(403).json({
        success: false,
        message: "Admin access required",
      });
    }

    return next();
  } catch (error) {
    return next(error);
  }
}