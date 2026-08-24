import { Router } from "express";

import {
  listProducts,
  getProductByIdentifier,
} from "../controllers/product.controller";

import reviewRoutes from "../routes/review.routes";

const router = Router();

router.get("/", listProducts);

router.use("/:productId/reviews", reviewRoutes);
router.get("/:identifier", getProductByIdentifier);

export default router;