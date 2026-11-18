import crypto from "crypto";
import { prisma } from "../config/prisma";

const ALLOWED_GIFTS = ["Smartwatch", "Wireless Earbuds", "Neckband"] as const;

export async function startGiftOffer(
  userId: string | null,
  visitorId: string,
  productId: number,
) {
  const product = await prisma.product.findFirst({
    where: {
      id: productId,
      active: true,
    },
    select: {
      id: true,
    },
  });

  if (!product) {
    throw new Error("PRODUCT_UNAVAILABLE");
  }

  return prisma.$transaction(async (tx) => {
    // Lock requests for the same visitor and product.
    const lockKey = `${visitorId}:${productId}`;

    // Materialize the advisory lock operation, but return only an integer
    // to Prisma. The PostgreSQL VOID result is never exposed.
    await tx.$queryRaw<Array<{ locked: number }>>`
      WITH lock AS MATERIALIZED (
        SELECT pg_advisory_xact_lock(hashtext(${lockKey}))
      )
      SELECT 1::int AS locked
      FROM lock
    `;

    const now = new Date();

    const existing = await tx.giftOffer.findFirst({
      where: {
        productId,
        consumedAt: null,
        expiresAt: {
          gt: now,
        },
        ...(userId
          ? {
              OR: [{ userId }, { visitorId }],
            }
          : {
              visitorId,
            }),
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
        expiresAt: true,
      },
    });

    if (existing) {
      // Attach the existing anonymous offer to the account
      // without resetting its expiry time.
      if (userId) {
        await tx.giftOffer.update({
          where: {
            id: existing.id,
          },
          data: {
            userId,
          },
        });
      }

      return existing;
    }

    return tx.giftOffer.create({
      data: {
        userId,
        visitorId,
        productId,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
      select: {
        id: true,
        expiresAt: true,
      },
    });
  });
}

export async function getMyGiftCards(userId: string) {
  return prisma.giftCard.findMany({
    where: {
      userId,
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      code: true,
      giftName: true,
      status: true,
      claimedAt: true,
      fulfilledAt: true,
      createdAt: true,
    },
  });
}

export async function claimGift(
  userId: string,
  code: string,
  giftName: string,
) {
  if (!ALLOWED_GIFTS.includes(giftName as (typeof ALLOWED_GIFTS)[number])) {
    throw new Error("INVALID_GIFT_SELECTION");
  }

  return prisma.$transaction(async (tx) => {
    const card = await tx.giftCard.findFirst({
      where: {
        userId,
        code,
        status: "AVAILABLE",
      },
    });

    if (!card) {
      throw new Error("GIFT_CODE_INVALID_OR_USED");
    }

    const changed = await tx.giftCard.updateMany({
      where: {
        id: card.id,
        userId,
        status: "AVAILABLE",
      },
      data: {
        giftName,
        status: "CLAIMED",
        claimedAt: new Date(),
      },
    });

    if (changed.count !== 1) {
      throw new Error("GIFT_CODE_INVALID_OR_USED");
    }

    return tx.giftCard.findUniqueOrThrow({
      where: {
        id: card.id,
      },
      select: {
        code: true,
        giftName: true,
        status: true,
        claimedAt: true,
      },
    });
  });
}

export async function listAdminGiftCards() {
  return prisma.giftCard.findMany({
    orderBy: {
      createdAt: "desc",
    },
  });
}

export async function updateAdminGiftCard(
  id: string,
  status: "APPROVED" | "DISPATCHED" | "FULFILLED" | "CANCELLED",
  adminNote?: string,
) {
  const card = await prisma.giftCard.findUnique({
    where: {
      id,
    },
  });

  if (!card) {
    throw new Error("GIFT_CARD_NOT_FOUND");
  }

  const allowedNext: Record<string, string[]> = {
    AVAILABLE: ["APPROVED", "CANCELLED"],
    CLAIMED: ["APPROVED", "CANCELLED"],
    APPROVED: ["DISPATCHED", "CANCELLED"],
    DISPATCHED: ["FULFILLED"],
  };

  if (!allowedNext[card.status]?.includes(status)) {
    throw new Error("INVALID_GIFT_STATUS_TRANSITION");
  }

  return prisma.giftCard.update({
    where: {
      id,
    },
    data: {
      status,
      ...(adminNote !== undefined ? { adminNote } : {}),
      ...(status === "FULFILLED" ? { fulfilledAt: new Date() } : {}),
    },
  });
}

export async function issueGiftCardForPaidOrder(orderId: string) {
  const order = await prisma.order.findUnique({
    where: {
      id: orderId,
    },
    select: {
      id: true,
      userId: true,
      giftOfferId: true,
      status: true,
    },
  });

  if (!order?.giftOfferId || order.status === "CANCELLED") {
    return null;
  }

  const code = `PB-GIFT-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

  return prisma.giftCard.upsert({
    where: {
      orderId,
    },
    create: {
      code,
      userId: order.userId,
      orderId,
    },
    update: {},
    select: {
      code: true,
      status: true,
    },
  });
}
