import { Router } from "express";
import rateLimit from "express-rate-limit";
import { recordPageVisit } from "../controllers/admin-dashboard.controller";

const router = Router();

const analyticsLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/events", analyticsLimiter, recordPageVisit);

export default router;