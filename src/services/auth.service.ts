import { prisma } from "../config/prisma";import {
  hashPassword,
  comparePassword,
} from "../utils/password";

import type {
  RegisterInput,
  LoginInput,
  UpdateProfileInput,
  ChangePasswordInput,
} from "../validators/auth.validator";

export async function registerUser(input: RegisterInput) {
  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [
        { email: input.email },
        ...(input.phone ? [{ phone: input.phone }] : []),
      ],
    },
    select: {
      email: true,
      phone: true,
    },
  });

  if (existingUser?.email === input.email) {
    throw new Error("EMAIL_ALREADY_EXISTS");
  }

  if (
    input.phone &&
    existingUser?.phone === input.phone
  ) {
    throw new Error("PHONE_ALREADY_EXISTS");
  }

  const passwordHash = await hashPassword(input.password);

  try {
    const user = await prisma.user.create({
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        passwordHash,
        phone: input.phone,
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

    return user;
  } catch (error) {
    // Database remains the final protection against
    // simultaneous duplicate registration requests.
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

      if (
        Array.isArray(target) &&
        target.includes("email")
      ) {
        throw new Error("EMAIL_ALREADY_EXISTS");
      }

      if (
        Array.isArray(target) &&
        target.includes("phone")
      ) {
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
  });

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

export async function updateProfile(
  userId: string,
  input: UpdateProfileInput,
) {
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

  const newPasswordHash = await hashPassword(
    input.newPassword,
  );

  await prisma.user.update({
    where: {
      id: userId,
    },
    data: {
      passwordHash: newPasswordHash,
    },
  });
}