import jwt from "jsonwebtoken";

const JWT_SECRET: string = process.env.JWT_SECRET || "";

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is not defined");
}

export interface JwtPayload {
  userId: string;
}

export function generateToken(userId: string): string {
  return jwt.sign(
    { userId },
    JWT_SECRET,
    {
      expiresIn: "7d",
    },
  );
}

export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, JWT_SECRET);

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