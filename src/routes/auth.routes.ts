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
import rateLimit from "express-rate-limit";
const router = Router();
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many login attempts. Try again in 15 minutes.",
  },
});

const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many registration attempts. Try again later.",
  },
});

const otpSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many OTP requests. Try again in 15 minutes.",
  },
});

const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many verification attempts. Try again later.",
  },
});

const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many password reset requests. Try again later.",
  },
});

router.post("/register", registrationLimiter, register);

router.post("/login", loginLimiter, login);

router.post("/logout", logout);

router.get("/me", authenticate, me);

router.patch("/me", authenticate, updateMe);

router.post("/phone/send-otp", otpSendLimiter, resendPhoneOtp);

router.post("/phone/verify", otpVerifyLimiter, verifyPhone);

router.post("/forgot-password", passwordResetLimiter, forgotPassword);

router.post("/reset-password", otpVerifyLimiter, resetPassword);

router.patch("/change-password", authenticate, changeUserPassword);

export default router;
