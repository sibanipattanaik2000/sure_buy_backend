import { Router } from "express";

import { authenticate } from "../middleware/auth.middleware";
import { requireAdmin } from "../middleware/admin.middleware";

import {
  createProductMediaUploadUrlController,
} from "../controllers/admin-product-media.controller";

const router = Router();

router.use(authenticate);
router.use(requireAdmin);

router.post(
  "/upload-url",
  createProductMediaUploadUrlController,
);

export default router;