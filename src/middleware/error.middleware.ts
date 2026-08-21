import type {
  Request,
  Response,
  NextFunction,
} from "express";

export function notFoundHandler(
  req: Request,
  res: Response,
) {
  return res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  console.error("UNHANDLED ERROR:", error);

  return res.status(500).json({
    success: false,
    message: "Internal server error",
  });
}