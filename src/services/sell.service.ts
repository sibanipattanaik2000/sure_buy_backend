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
export async function getSellCatalog() {
  const products = await prisma.product.findMany({
    where: {
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
    },
    orderBy: [
      {
        brand: "asc",
      },
      {
        name: "asc",
      },
    ],
  });

  const brandsMap = new Map<
    string,
    {
      name: string;
      models: {
        id: number;
        name: string;
      }[];
    }
  >();

  for (const product of products) {
    if (!product.brand || !product.name) {
      continue;
    }

    const brandName = product.brand.trim();

    if (!brandsMap.has(brandName)) {
      brandsMap.set(brandName, {
        name: brandName,
        models: [],
      });
    }

    brandsMap.get(brandName)!.models.push({
      id: product.id,
      name: product.name,
    });
  }

  return {
    category: "Smartphones",
    brands: Array.from(brandsMap.values()),
  };
}
export async function getSellRequestById(
  userId: string,
  sellRequestId: string,
) {
  const sellRequest = await prisma.sellRequest.findFirst({
    where: {
      id: sellRequestId,
      userId,
    },

    select: {
      id: true,
      userId: true,
      productId: true,

      workingStatus: true,
      screenCondition: true,
      deviceCondition: true,
      batteryCondition: true,

      estimatedValue: true,
      finalValue: true,

      pickupAddress: true,
      pickupDate: true,
      pickupSlot: true,

      status: true,

      createdAt: true,
      updatedAt: true,

      product: {
        select: {
          id: true,
          name: true,
          brand: true,

          images: {
            orderBy: {
              position: "asc",
            },

            take: 5,

            select: {
              id: true,
              url: true,
              altText: true,
              position: true,
            },
          },
        },
      },

      media: {
        orderBy: {
          position: "asc",
        },

        select: {
          id: true,
          url: true,
          key: true,
          mimeType: true,
          size: true,
          position: true,
          createdAt: true,
        },
      },

      sellPayments: {
        orderBy: {
          createdAt: "desc",
        },

        take: 1,

        select: {
          id: true,
          amount: true,
          currency: true,
          status: true,
          method: true,
          providerPaymentId: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!sellRequest) {
    throw new Error("SELL_REQUEST_NOT_FOUND");
  }

  const payment = sellRequest.sellPayments[0] ?? null;

  return {
    id: sellRequest.id,

    product: {
      id: sellRequest.product.id,
      name: sellRequest.product.name,
      brand: sellRequest.product.brand,

      images: sellRequest.product.images,
    },

    conditions: {
      workingStatus: sellRequest.workingStatus,
      screenCondition: sellRequest.screenCondition,
      deviceCondition: sellRequest.deviceCondition,
      batteryCondition: sellRequest.batteryCondition,
    },

    valuation: {
      estimatedValue: Number(
        sellRequest.estimatedValue,
      ),

      finalValue:
        sellRequest.finalValue !== null
          ? Number(sellRequest.finalValue)
          : null,
    },

    pickup: {
      address: sellRequest.pickupAddress,
      date: sellRequest.pickupDate,
      slot: sellRequest.pickupSlot,
    },

    status: sellRequest.status,

    media: sellRequest.media,

    payment: payment
      ? {
          id: payment.id,
          amount: Number(payment.amount),
          currency: payment.currency,
          status: payment.status,
          method: payment.method,
          razorpayPaymentId:
            payment.providerPaymentId,
          createdAt: payment.createdAt,
          updatedAt: payment.updatedAt,
        }
      : null,

    createdAt: sellRequest.createdAt,
    updatedAt: sellRequest.updatedAt,
  };
}
