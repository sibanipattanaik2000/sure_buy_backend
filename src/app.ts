import express from "express";
import authRoutes from "./routes/auth.routes";

const app = express();

app.use(express.json());

app.use("/api/v1/auth", authRoutes);

app.get("/api/v1/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Sure-Buy API is running",
    environment: process.env.NODE_ENV || "development",
  });
});

export default app;