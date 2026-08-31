import { Router } from "express";

import {
  register,
  login,
  logout,
  me,
  updateMe,
  changeUserPassword,
  resendPhoneOtp,
  verifyPhone,
  forgotPassword,
  resetPassword,
} from "../controllers/auth.controller";

import { authenticate } from "../middleware/auth.middleware";

const router = Router();

router.post("/register", register);

router.post("/login", login);

router.post("/logout", logout);

router.get("/me", authenticate, me);

router.patch("/me", authenticate, updateMe);
router.post("/phone/send-otp", resendPhoneOtp);

router.post("/phone/verify", verifyPhone);

router.post("/forgot-password", forgotPassword);

router.post("/reset-password", resetPassword);

router.patch(
  "/change-password",
  authenticate,
  changeUserPassword,
);

export default router;