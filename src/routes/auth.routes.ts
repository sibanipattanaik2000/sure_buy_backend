import { Router } from "express";

import {
  register,
  login,
  logout,
  me,
  updateMe,
  changeUserPassword,
} from "../controllers/auth.controller";

import { authenticate } from "../middleware/auth.middleware";

const router = Router();

router.post("/register", register);

router.post("/login", login);

router.post("/logout", logout);

router.get("/me", authenticate, me);

router.patch("/me", authenticate, updateMe);

router.patch(
  "/change-password",
  authenticate,
  changeUserPassword,
);

export default router;