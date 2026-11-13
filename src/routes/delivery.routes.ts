
import { Router } from "express";
import {
  checkDeliveryServiceability,
  receiveDeliveryEvent,
} from "../controllers/delivery.controller";

const router = Router();

router.get("/serviceability", checkDeliveryServiceability);

// Neutral URL: Shiprocket requires x-api-key webhook authentication.
router.post("/events", receiveDeliveryEvent);

export default router;
