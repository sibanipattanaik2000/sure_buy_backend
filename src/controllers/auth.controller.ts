import type { Request, Response } from "express";

import { generateToken } from "../utils/jwt";

import {
  registerUser,
  loginUser,
  getCurrentUser,
  updateProfile,
  changePassword,
} from "../services/auth.service";

import type { AuthRequest } from "../middleware/auth.middleware";

import {
  registerSchema,
  loginSchema,
  updateProfileSchema,
  changePasswordSchema,
} from "../validators/auth.validator";

import { ZodError } from "zod";

const AUTH_COOKIE_NAME = "phonebhai_access_token";

const authCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite:
    process.env.NODE_ENV === "production"
      ? ("none" as const)
      : ("lax" as const),
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: "/",
};

export async function register(req: Request, res: Response) {
  try {
    const input = registerSchema.parse(req.body);

    const user = await registerUser(input);

    return res.status(201).json({
      success: true,
      message: "Account created successfully",
      data: user,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({
        success: false,
        message: "Invalid registration data",
        errors: error.flatten().fieldErrors,
      });
    }

    if (
      error instanceof Error &&
      error.message === "EMAIL_ALREADY_EXISTS"
    ) {
      return res.status(409).json({
        success: false,
        message: "Email already registered",
      });
    }

    console.error("REGISTER ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
}

export async function login(req: Request, res: Response) {
  try {
    const input = loginSchema.parse(req.body);

    const user = await loginUser(input);

    const token = generateToken(user.id);

    res.cookie(
      AUTH_COOKIE_NAME,
      token,
      authCookieOptions
    );

    return res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        user,
      },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({
        success: false,
        message: "Invalid login data",
        errors: error.flatten().fieldErrors,
      });
    }

    if (
      error instanceof Error &&
      error.message === "INVALID_CREDENTIALS"
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    console.error("LOGIN ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
}

export async function logout(_req: Request, res: Response) {
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite:
      process.env.NODE_ENV === "production"
        ? ("none" as const)
        : ("lax" as const),
    path: "/",
  });

  return res.status(200).json({
    success: true,
    message: "Logged out successfully",
  });
}

export async function me(req: AuthRequest, res: Response) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const user = await getCurrentUser(req.userId);

    return res.status(200).json({
      success: true,
      message: "Current user",
      data: user,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "USER_NOT_FOUND"
    ) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    console.error("ME ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
}

export async function updateMe(
  req: AuthRequest,
  res: Response,
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const input = updateProfileSchema.parse(req.body);

    const user = await updateProfile(
      req.userId,
      input,
    );

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: user,
    });
  } catch (error) {
    console.error("UPDATE PROFILE ERROR:", error);

    if (error instanceof ZodError) {
      return res.status(400).json({
        success: false,
        message: "Invalid profile data",
        errors: error.flatten().fieldErrors,
      });
    }

    if (
      error instanceof Error &&
      error.message === "USER_NOT_FOUND"
    ) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
}

export async function changeUserPassword(
  req: AuthRequest,
  res: Response,
) {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const input = changePasswordSchema.parse(req.body);

    await changePassword(req.userId, input);

    return res.status(200).json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    console.error("CHANGE PASSWORD ERROR:", error);

    if (error instanceof ZodError) {
      return res.status(400).json({
        success: false,
        message: "Invalid password data",
        errors: error.flatten().fieldErrors,
      });
    }

    if (
      error instanceof Error &&
      error.message === "INVALID_CURRENT_PASSWORD"
    ) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    if (
      error instanceof Error &&
      error.message === "USER_NOT_FOUND"
    ) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
}