import { PrismaClient } from "@prisma/client";
import { prisma } from "../config/prisma";
import type {
  CreateAddressInput,
  UpdateAddressInput,
} from "../validators/address.validator";

type TransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;

export async function getUserAddresses(userId: string) {
  return prisma.address.findMany({
    where: {
      userId,
    },
    orderBy: [
      {
        isDefault: "desc",
      },
      {
        createdAt: "desc",
      },
    ],
  });
}

export async function getAddressById(
  userId: string,
  addressId: string,
) {
  return prisma.address.findFirst({
    where: {
      id: addressId,
      userId,
    },
  });
}

export async function createAddress(
  userId: string,
  data: CreateAddressInput,
) {
  return prisma.$transaction(async (tx: TransactionClient) => {
    if (data.isDefault) {
      await tx.address.updateMany({
        where: {
          userId,
          isDefault: true,
        },
        data: {
          isDefault: false,
        },
      });
    }

    const existingAddressCount = await tx.address.count({
      where: {
        userId,
      },
    });

    return tx.address.create({
      data: {
        userId,
        fullName: data.fullName,
        phone: data.phone,
        addressLine1: data.addressLine1,
        addressLine2: data.addressLine2,
        city: data.city,
        state: data.state,
        postalCode: data.postalCode,
        country: data.country,
        landmark: data.landmark,
        isDefault:
          existingAddressCount === 0 ? true : data.isDefault,
      },
    });
  });
}

export async function updateAddress(
  userId: string,
  addressId: string,
  data: UpdateAddressInput,
) {
  return prisma.$transaction(async (tx: TransactionClient) => {
    const existingAddress = await tx.address.findFirst({
      where: {
        id: addressId,
        userId,
      },
    });

    if (!existingAddress) {
      return null;
    }

    if (data.isDefault === true) {
      await tx.address.updateMany({
        where: {
          userId,
          id: {
            not: addressId,
          },
          isDefault: true,
        },
        data: {
          isDefault: false,
        },
      });
    }

    return tx.address.update({
      where: {
        id: addressId,
      },
      data,
    });
  });
}

export async function deleteAddress(
  userId: string,
  addressId: string,
) {
  return prisma.$transaction(async (tx: TransactionClient) => {
    const address = await tx.address.findFirst({
      where: {
        id: addressId,
        userId,
      },
    });

    if (!address) {
      return null;
    }

    await tx.address.delete({
      where: {
        id: addressId,
      },
    });

    if (address.isDefault) {
      const nextAddress = await tx.address.findFirst({
        where: {
          userId,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      if (nextAddress) {
        await tx.address.update({
          where: {
            id: nextAddress.id,
          },
          data: {
            isDefault: true,
          },
        });
      }
    }

    return address;
  });
}

export async function setDefaultAddress(
  userId: string,
  addressId: string,
) {
  return prisma.$transaction(async (tx: TransactionClient) => {
    const address = await tx.address.findFirst({
      where: {
        id: addressId,
        userId,
      },
    });

    if (!address) {
      return null;
    }

    await tx.address.updateMany({
      where: {
        userId,
        isDefault: true,
        id: {
          not: addressId,
        },
      },
      data: {
        isDefault: false,
      },
    });

    return tx.address.update({
      where: {
        id: addressId,
      },
      data: {
        isDefault: true,
      },
    });
  });
}