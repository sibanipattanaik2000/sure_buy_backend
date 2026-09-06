import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { requireAdmin } from "../middleware/admin.middleware";
import { createAdminProductController } from "../controllers/admin-product.controller";

const router = Router();

router.use(authenticate);
router.use(requireAdmin);

router.post("/", createAdminProductController);

export default router;