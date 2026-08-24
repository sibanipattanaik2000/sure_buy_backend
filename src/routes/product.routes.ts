import { Router } from "express";

import {
  listProducts,
  getProductBySlug,
} from "../controllers/product.controller";

import reviewRoutes from "../routes/review.routes";

const router = Router();

router.get("/", listProducts);
router.get("/:slug", getProductBySlug);

router.use("/:productId/reviews", reviewRoutes);

export default router;