import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import wishlistRoutes from "./routes/wishlist.routes";
import { env } from "./config/env";
import newsletterRoutes from "./routes/newsletter.routes";
import authRoutes from "./routes/auth.routes";
import productRoutes from "./routes/product.routes";
import addressRoutes from "./routes/address.routes";
import cartRoutes from "./routes/cart.routes";
import orderRoutes from "./routes/order.routes";
import sellRoutes from "./routes/sell.routes";
import paymentRoutes from "./routes/payment.routes";
import { notFoundHandler, errorHandler } from "./middleware/error.middleware";
import sellPaymentRoutes from "./routes/sell-payment.routes";
const app = express();

/**
 * Security headers
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
 * General API rate limiting
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
app.use(
  express.json({
    limit: "1mb",

    verify: (req, _res, buf) => {
      const request = req as express.Request;

      if (
        request.originalUrl ===
        "/api/v1/payments/webhook"
      ) {
        request.rawBody = Buffer.from(buf);
      }
    },
  }),
);

app.use(
  express.urlencoded({
    extended: true,
  }),
);

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

app.use("/api/v1/cart", cartRoutes);
app.use("/api/v1/orders", orderRoutes);
app.use("/api/v1/wishlist", wishlistRoutes);
app.use("/api/v1/sell", sellRoutes);
app.use("/api/v1/payments", paymentRoutes);
app.use("/api/v1/sell/payments", sellPaymentRoutes);
app.use(
  "/api/v1/newsletter",
  newsletterRoutes,
);
/**
 * 404 handler
 */
app.use(notFoundHandler);

/**
 * Global error handler
 */
app.use(errorHandler);

export default app;
