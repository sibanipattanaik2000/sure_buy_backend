import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { requireAdmin } from "../middleware/admin.middleware";

import {
  adminGiftCardsController,
  adminUpdateGiftCardController,
} from "../controllers/gift.controller";

const router = Router();

router.use(authenticate, requireAdmin);

router.get("/", adminGiftCardsController);
router.patch("/:id", adminUpdateGiftCardController);

export default router;
