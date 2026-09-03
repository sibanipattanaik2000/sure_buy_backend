import { prisma } from "../config/prisma";
import { hashPassword, comparePassword } from "../utils/password";

import type {
  RegisterInput,
  LoginInput,
  UpdateProfileInput,
  ChangePasswordInput,
  VerifyPhoneInput,
  ResetPasswordInput,
} from "../validators/auth.validator";
import {
  sendPhoneVerification,
  verifyPhoneCode,
} from "./phone-verification.service";

export async function registerUser(input: RegisterInput) {
  const existingEmailUser = await prisma.user.findUnique({
    where: {
      email: input.email,
    },
    include: {
      phoneVerification: true,
    },
  });

  const existingPhoneUser = await prisma.user.findUnique({
    where: {
      phone: input.phone,
    },
    include: {
      phoneVerification: true,
    },
  });

  /*
   * ---------------------------------------------------------
   * EXISTING EMAIL
   * ---------------------------------------------------------
   */

  if (existingEmailUser) {
    const isEmailVerified =
      existingEmailUser.phoneVerification?.verifiedAt !== null &&
      existingEmailUser.phoneVerification?.verifiedAt !== undefined;

    /*
     * A verified account is a real existing account.
     */
    if (isEmailVerified) {
      throw new Error("EMAIL_ALREADY_EXISTS");
    }

    /*
     * The email exists but the account is still unverified.
     *
     * Only allow the registration flow to continue when the
     * phone number is also the same account's phone number.
     */
    if (existingEmailUser.phone === input.phone) {
      await sendPhoneVerification(input.phone);

      return {
        id: existingEmailUser.id,
        firstName: existingEmailUser.firstName,
        lastName: existingEmailUser.lastName,
        email: existingEmailUser.email,
        phone: existingEmailUser.phone,
        createdAt: existingEmailUser.createdAt,
      };
    }

    /*
     * Same email but different phone:
     * do not overwrite or modify the existing account.
     */
    throw new Error("EMAIL_ALREADY_EXISTS");
  }

  /*
   * ---------------------------------------------------------
   * EXISTING PHONE
   * ---------------------------------------------------------
   */

  if (existingPhoneUser) {
    const isPhoneVerified =
      existingPhoneUser.phoneVerification?.verifiedAt !== null &&
      existingPhoneUser.phoneVerification?.verifiedAt !== undefined;

    /*
     * A verified phone belongs to an existing account.
     */
    if (isPhoneVerified) {
      throw new Error("PHONE_ALREADY_EXISTS");
    }

    /*
     * Unverified phone with a different email.
     *
     * Do not merge two registration attempts because that could
     * associate the wrong email/password with an existing account.
     */
    throw new Error("PHONE_ALREADY_EXISTS");
  }

  /*
   * ---------------------------------------------------------
   * BRAND NEW ACCOUNT
   * ---------------------------------------------------------
   */

  const passwordHash = await hashPassword(input.password);

  try {
    const user = await prisma.user.create({
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        passwordHash,
        phone: input.phone,
        phoneVerification: {
          create: {},
        },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        createdAt: true,
      },
    });

    /*
     * Send OTP only after the user has been successfully created.
     */
    try {
      await sendPhoneVerification(user.phone!);
    } catch (error) {
      console.error("REGISTRATION OTP SEND ERROR:", error);

      /*
       * Do not leave an unusable account in the database if the
       * initial OTP could not be sent.
       */
      await prisma.user.delete({
        where: {
          id: user.id,
        },
      });

      throw new Error("OTP_SEND_FAILED");
    }

    return user;
  } catch (error) {
    /*
     * Handle concurrent registration requests safely.
     */
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2002"
    ) {
      const target =
        "meta" in error &&
        error.meta &&
        typeof error.meta === "object" &&
        "target" in error.meta
          ? error.meta.target
          : undefined;

      if (Array.isArray(target) && target.includes("email")) {
        throw new Error("EMAIL_ALREADY_EXISTS");
      }

      if (Array.isArray(target) && target.includes("phone")) {
        throw new Error("PHONE_ALREADY_EXISTS");
      }
    }

    throw error;
  }
}

export async function loginUser(input: LoginInput) {
  const user = await prisma.user.findUnique({
    where: {
      email: input.email,
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      passwordHash: true,
      createdAt: true,
    },
  });

  // Do not reveal whether the email exists.
  if (!user) {
    throw new Error("INVALID_CREDENTIALS");
  }

  const passwordMatch = await comparePassword(
    input.password,
    user.passwordHash,
  );

  if (!passwordMatch) {
    throw new Error("INVALID_CREDENTIALS");
  }

  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone,
    createdAt: user.createdAt,
  };
}

export async function getCurrentUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      createdAt: true,
    },
  });

  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }

  return user;
}

export async function updateProfile(userId: string, input: UpdateProfileInput) {
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
  });

  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }

  const updatedUser = await prisma.user.update({
    where: {
      id: userId,
    },
    data: {
      ...(input.firstName !== undefined && {
        firstName: input.firstName,
      }),

      ...(input.lastName !== undefined && {
        lastName: input.lastName,
      }),

      ...(input.email !== undefined && {
        email: input.email,
      }),

      ...(input.phone !== undefined && {
        phone: input.phone,
      }),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      createdAt: true,
    },
  });

  return updatedUser;
}
export async function changePassword(
  userId: string,
  input: ChangePasswordInput,
) {
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
  });

  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }

  const passwordMatch = await comparePassword(
    input.currentPassword,
    user.passwordHash,
  );

  if (!passwordMatch) {
    throw new Error("INVALID_CURRENT_PASSWORD");
  }

  const newPasswordHash = await hashPassword(input.newPassword);

  await prisma.user.update({
    where: {
      id: userId,
    },
    data: {
      passwordHash: newPasswordHash,
    },
  });
}

export async function verifyUserPhone(input: VerifyPhoneInput) {
  const user = await prisma.user.findUnique({
    where: {
      phone: input.phone,
    },
    include: {
      phoneVerification: true,
    },
  });

  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }

  const result = await verifyPhoneCode(input.phone, input.code);

  if (result?.status !== "approved") {
    throw new Error("INVALID_OTP");
  }

  await prisma.userPhoneVerification.upsert({
    where: {
      userId: user.id,
    },
    create: {
      userId: user.id,
      verifiedAt: new Date(),
    },
    update: {
      verifiedAt: new Date(),
    },
  });

  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone,
    createdAt: user.createdAt,
  };
}

export async function requestPasswordReset(phone: string) {
  const user = await prisma.user.findUnique({
    where: {
      phone,
    },
    select: {
      id: true,
      phone: true,
    },
  });

  // Do not reveal whether an account exists.
  if (!user) {
    return;
  }

  await sendPhoneVerification(user.phone!);
}
export async function resetPasswordWithOtp(input: ResetPasswordInput) {
  const user = await prisma.user.findUnique({
    where: {
      phone: input.phone,
    },
  });

  if (!user) {
    throw new Error("INVALID_RESET_REQUEST");
  }

  const result = await verifyPhoneCode(input.phone, input.code);

  if (result?.status !== "approved") {
    throw new Error("INVALID_OTP");
  }

  const passwordHash = await hashPassword(input.newPassword);

  await prisma.user.update({
    where: {
      id: user.id,
    },
    data: {
      passwordHash,
    },
  });
}
