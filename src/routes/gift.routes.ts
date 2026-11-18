import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";

import {
  startGiftOfferController,
  myGiftCardsController,
  claimGiftController,
} from "../controllers/gift.controller";

const router = Router();

// Public: visitors and logged-in customers can start the offer.
router.post("/offers", startGiftOfferController);

// Protected: customer gift-card operations.
router.get("/cards", authenticate, myGiftCardsController);
router.post("/cards/claim", authenticate, claimGiftController);

export default router;