import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import addressRoutes from "./routes/address.routes";
import { env } from "./config/env";
import authRoutes from "./routes/auth.routes";
import {
  notFoundHandler,
  errorHandler,
} from "./middleware/error.middleware";
import productRoutes from "./routes/product.routes";
const app = express();

/**
 * Security
 */
app.use(helmet());

/**
 * CORS
 */
app.use(
  cors({
    origin: env.FRONTEND_URL,
    credentials: true,
  }),
);

/**
 * Rate limiting
 *
 * This is a general application-level limit.
 * Authentication-specific limits can be added later.
 */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests. Please try again later.",
  },
});

app.use("/api", apiLimiter);

/**
 * Request parsing
 */
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

/**
 * Health check
 */
app.get("/api/v1/health", (_req, res) => {
  return res.status(200).json({
    success: true,
    message: "Sure-Buy API is running",
    environment: env.NODE_ENV,
  });
});

/**
 * API routes
 */
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/products", productRoutes);
app.use("/api/v1/addresses", addressRoutes);
/**
 * 404 handler
 */
app.use(notFoundHandler);

/**
 * Global error handler
 */
app.use(errorHandler);

export default app;