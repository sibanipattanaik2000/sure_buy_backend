import { Router } from "express";

import {
  checkDeliveryServiceability,
  receiveDeliveryEvent,
  runShiprocketWorker,
} from "../controllers/delivery.controller";

const router = Router();

router.get("/serviceability", checkDeliveryServiceability);

// Shiprocket tracking webhook.
router.post("/events", receiveDeliveryEvent);

// Protected background worker.
router.post("/worker/process", runShiprocketWorker);

export default router;