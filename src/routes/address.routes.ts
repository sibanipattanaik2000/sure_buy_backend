import { Router } from "express";

import { authenticate } from "../middleware/auth.middleware";

import {
  listAddresses,
  addAddress,
  editAddress,
  removeAddress,
  makeDefaultAddress,
} from "../controllers/address.controller";

const router = Router();

router.use(authenticate);

router.get("/", listAddresses);

router.post("/", addAddress);

router.patch("/:id", editAddress);

router.delete("/:id", removeAddress);

router.patch("/:id/default", makeDefaultAddress);

export default router;