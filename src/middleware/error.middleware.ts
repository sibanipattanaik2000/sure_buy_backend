
import type {
  Request,
  Response,
  NextFunction,
} from "express";

export function notFoundHandler(
  _req: Request,
  res: Response,
) {
  return res.status(404).json({
    success: false,
    message: "API route not found",
  });
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  // Log a safe summary for diagnostics, not the raw error object.
  const errorName =
    error instanceof Error ? error.name : "UnknownError";

  console.error("API request failed", {
    method: req.method,
    path: req.path,
    errorName,
  });

  return res.status(500).json({
    success: false,
    message: "Internal server error",
  });
}
