import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";

import wishlistRoutes from "./routes/wishlist.routes";
import newsletterRoutes from "./routes/newsletter.routes";
import authRoutes from "./routes/auth.routes";
import productRoutes from "./routes/product.routes";
import addressRoutes from "./routes/address.routes";
import cartRoutes from "./routes/cart.routes";
import orderRoutes from "./routes/order.routes";
import sellRoutes from "./routes/sell.routes";
import paymentRoutes from "./routes/payment.routes";
import sellPaymentRoutes from "./routes/sell-payment.routes";
import adminProductMediaRoutes from "./routes/admin-product-media.routes";
import adminProductRoutes from "./routes/admin-product.routes";

import { env } from "./config/env";
import { notFoundHandler, errorHandler } from "./middleware/error.middleware";

const app = express();

app.use(helmet());

/**
 * CORS
 *
 * PhoneBhai frontend currently runs on Vercel while the API runs
 * on api.phonebhai.com, so credentials must be explicitly allowed.
 */
const allowedOrigins = new Set(
  [
    "http://localhost:3000",
    "https://phone-bhai-web.vercel.app",
    "https://phonebhai.com",
    "https://www.phonebhai.com",
    env.FRONTEND_URL,
  ]
    .filter(Boolean)
    .map((origin) => origin.replace(/\/+$/, "")),
);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server requests and requests without an Origin.
      if (!origin) {
        return callback(null, true);
      }

      const normalizedOrigin = origin.replace(/\/+$/, "");

      if (allowedOrigins.has(normalizedOrigin)) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  }),
);

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

app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      const request = req as express.Request;

      if (request.originalUrl === "/api/v1/payments/webhook") {
        request.rawBody = Buffer.from(buf);
      }
    },
  }),
);

app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

/**
 * Health check
 */
app.get("/api/v1/health", (_req, res) => {
  return res.status(200).json({
    success: true,
    message: "PhoneBhai API is running",
    environment: env.NODE_ENV,
  });
});

/**
 * API routes
 */
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/products", productRoutes);

app.use(
  "/api/v1/admin/product-media",
  adminProductMediaRoutes,
);

app.use(
  "/api/v1/admin/products",
  adminProductRoutes,
);

app.use("/api/v1/addresses", addressRoutes);
app.use("/api/v1/cart", cartRoutes);
app.use("/api/v1/orders", orderRoutes);
app.use("/api/v1/wishlist", wishlistRoutes);
app.use("/api/v1/sell", sellRoutes);
app.use("/api/v1/payments", paymentRoutes);
app.use("/api/v1/sell/payments", sellPaymentRoutes);
app.use("/api/v1/newsletter", newsletterRoutes);

/**
 * 404 + global error handling
 */
app.use(notFoundHandler);
app.use(errorHandler);

export default app;