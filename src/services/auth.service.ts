import { prisma } from "../config/prisma";
import { hashPassword, comparePassword } from "../utils/password";
import { randomBytes } from "crypto";
import type {
  RegisterInput,
  LoginInput,
  UpdateProfileInput,
  ChangePasswordInput,
  VerifyPhoneInput,
  ResetPasswordInput,
  VerifyRegistrationInput,
} from "../validators/auth.validator";
import {
  sendPhoneVerification,
  verifyPhoneCode,
} from "./phone-verification.service";
import {
  sendProtectedPhoneOtp,
  verifyProtectedPhoneOtp,
} from "./phone-otp-security.service";

export async function registerUser(input: RegisterInput) {
  if (!input.phone) {
    throw new Error("PHONE_NOT_FOUND");
  }

  const existingUser = await prisma.user.findUnique({
    where: { phone: input.phone },
    select: { id: true },
  });

  if (existingUser) {
    throw new Error("PHONE_ALREADY_EXISTS");
  }

  const otp = await sendProtectedPhoneOtp(input.phone);

  return {
    ...otp,
    message: "Verification code sent successfully",
  };
}
export async function completePhoneRegistration(
  input: VerifyRegistrationInput,
) {
  const result = await verifyPhoneCode(input.phone, input.code);

  if (result?.status !== "approved") {
    throw new Error("INVALID_OTP");
  }

  // Recheck after OTP verification to protect against duplicate
  // or simultaneous registration attempts.
  const existingUser = await prisma.user.findUnique({
    where: { phone: input.phone },
    select: { id: true },
  });

  if (existingUser) {
    throw new Error("PHONE_ALREADY_EXISTS");
  }

  const nameParts = input.fullName.trim().split(/\s+/);
  const firstName = nameParts[0];
  const lastName = nameParts.slice(1).join(" ") || "Customer";

  // The current Prisma User model requires email and passwordHash.
  // Customers do not need to enter or use either field.
  const email = `phone-${input.phone}@accounts.phonebhai.invalid`;
  const passwordHash = await hashPassword(randomBytes(32).toString("hex"));

  try {
    return await prisma.user.create({
      data: {
        firstName,
        lastName,
        email,
        passwordHash,
        phone: input.phone,
        phoneVerification: {
          create: {
            verifiedAt: new Date(),
          },
        },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        createdAt: true,
        role: true,
      },
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2002"
    ) {
      throw new Error("PHONE_ALREADY_EXISTS");
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
      role: true,
    },
  });

  // Do not reveal whether the email exists.
  if (!user || !user.passwordHash) {
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
    role: user.role,
  };
}
export async function requestLoginPhoneOtp(phone: string) {
  const user = await prisma.user.findUnique({
    where: { phone },
    select: {
      id: true,
      phone: true,
    },
  });

  // Avoid revealing whether an account exists.
  if (!user?.phone) {
    return null;
  }

  return sendProtectedPhoneOtp(user.phone);
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
      role: true,
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

  if (!user.passwordHash) {
    throw new Error("INVALID_CURRENT_PASSWORD");
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

  const verifiedPhone = user.phone;

  if (typeof verifiedPhone !== "string" || !verifiedPhone.trim()) {
    throw new Error("PHONE_NOT_FOUND");
  }
  await verifyProtectedPhoneOtp(input.phone, input.code);
  // const result = await verifyPhoneCode(input.phone, input.code);

  // if (result?.status !== "approved") {
  //   throw new Error("INVALID_OTP");
  // }

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
    phone: verifiedPhone,
    createdAt: user.createdAt,
    role: user.role,
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
  if (!user || !user.phone) {
    return;
  }

  await sendPhoneVerification(user.phone);
}

export async function resetPasswordWithOtp(input: ResetPasswordInput) {
  const resetPhone = input.phone;

  if (typeof resetPhone !== "string" || !resetPhone.trim()) {
    throw new Error("PHONE_NOT_FOUND");
  }

  const user = await prisma.user.findUnique({
    where: {
      phone: resetPhone,
    },
  });

  if (!user) {
    throw new Error("INVALID_RESET_REQUEST");
  }

  const result = await verifyPhoneCode(resetPhone, input.code);

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
