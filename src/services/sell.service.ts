import { prisma } from "../config/prisma";

export type CreateSellRequestInput = {
  userId: string;
  productId: number;

  workingStatus: string;
  screenCondition: string;
  deviceCondition: string;
  batteryCondition: string;

  pickupAddress: string;
  pickupDate: Date;
  pickupSlot: string;

  media?: Array<{
    url: string;
    key: string;
    mimeType: string;
    size: number;
    position: number;
  }>;
};

function getConditionMultiplier(condition: string) {
  switch (condition) {
    case "Like New":
      return 0.7;

    case "Good":
      return 0.6;

    case "Fair":
      return 0.5;

    case "Poor":
      return 0.35;

    default:
      return 0.5;
  }
}

export async function createSellRequest(
  input: CreateSellRequestInput,
) {
  const product = await prisma.product.findFirst({
  where: {
    id: input.productId,
    active: true,
    category: {
      equals: "Smartphones",
      mode: "insensitive",
    },
  },
    select: {
      id: true,
      name: true,
      brand: true,
      price: true,
    },
  });

  if (!product) {
    throw new Error("PRODUCT_NOT_FOUND");
  }

  /*
   * PhoneBhai currently sells phones only.
   *
   * The current Product catalogue does not have a dedicated
   * "Smartphone" category, so the product catalogue itself is
   * the source of truth.
   */

  const multiplier = getConditionMultiplier(
    input.deviceCondition,
  );

  const estimatedValue = Number(product.price) * multiplier;

  const sellRequest = await prisma.sellRequest.create({
    data: {
      userId: input.userId,
      productId: product.id,

      workingStatus: input.workingStatus,
      screenCondition: input.screenCondition,
      deviceCondition: input.deviceCondition,
      batteryCondition: input.batteryCondition,

      estimatedValue: Math.round(estimatedValue),
      pickupAddress: input.pickupAddress,
      pickupDate: input.pickupDate,
      pickupSlot: input.pickupSlot,

      status: "SUBMITTED",

      ...(input.media?.length
        ? {
            media: {
              create: input.media.map((item) => ({
                url: item.url,
                key: item.key,
                mimeType: item.mimeType,
                size: item.size,
                position: item.position,
              })),
            },
          }
        : {}),
    },

    include: {
      product: {
        select: {
          id: true,
          name: true,
          brand: true,
          price: true,
          images: {
            orderBy: {
              position: "asc",
            },
            take: 1,
          },
        },
      },

      media: {
        orderBy: {
          position: "asc",
        },
      },
    },
  });

  return sellRequest;
}