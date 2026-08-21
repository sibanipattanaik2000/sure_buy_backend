import jwt from "jsonwebtoken";
import { env } from "../config/env";

export interface JwtPayload {
  userId: string;
}

export function generateToken(userId: string): string {
  return jwt.sign(
    { userId },
    env.JWT_SECRET,
    {
      expiresIn: "7d",
    },
  );
}

export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET);

  if (
    typeof decoded === "string" ||
    typeof decoded.userId !== "string"
  ) {
    throw new Error("INVALID_TOKEN");
  }

  return {
    userId: decoded.userId,
  };
}