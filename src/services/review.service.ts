import { PrismaClient } from "@prisma/client";
import { prisma } from "../config/database";

interface ReviewInput {
  rating: number;
  comment: string;
}

type TransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;

export async function getProductReviews(
  productId: number,
  page: number,
  limit: number,
) {
  const skip = (page - 1) * limit;

  const [reviews, total] = await Promise.all([
    prisma.review.findMany({
      where: {
        productId,
      },

      orderBy: {
        createdAt: "desc",
      },

      skip,
      take: limit,

      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    }),

    prisma.review.count({
      where: {
        productId,
      },
    }),
  ]);

  return {
    reviews,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNextPage: page < Math.ceil(total / limit),
      hasPreviousPage: page > 1,
    },
  };
}

export async function createProductReview(
  userId: string,
  productId: number,
  input: ReviewInput,
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
    throw new Error("PRODUCT_NOT_FOUND");
  }

  const existingReview = await prisma.review.findUnique({
    where: {
      productId_userId: {
        productId,
        userId,
      },
    },
  });

  if (existingReview) {
    throw new Error("REVIEW_ALREADY_EXISTS");
  }

  return prisma.$transaction(async (tx: TransactionClient) => {
    const review = await tx.review.create({
      data: {
        productId,
        userId,
        rating: input.rating,
        comment: input.comment,
      },

      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    await updateProductRating(tx, productId);

    return review;
  });
}

export async function updateProductReview(
  userId: string,
  reviewId: number,
  input: Partial<ReviewInput>,
) {
  const existingReview = await prisma.review.findUnique({
    where: {
      id: reviewId,
    },
  });

  if (!existingReview) {
    throw new Error("REVIEW_NOT_FOUND");
  }

  if (existingReview.userId !== userId) {
    throw new Error("NOT_REVIEW_OWNER");
  }

  return prisma.$transaction(async (tx: TransactionClient) => {
    const review = await tx.review.update({
      where: {
        id: reviewId,
      },

      data: {
        ...(input.rating !== undefined
          ? { rating: input.rating }
          : {}),

        ...(input.comment !== undefined
          ? { comment: input.comment }
          : {}),
      },

      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    await updateProductRating(tx, existingReview.productId);

    return review;
  });
}

export async function deleteProductReview(
  userId: string,
  reviewId: number,
) {
  const existingReview = await prisma.review.findUnique({
    where: {
      id: reviewId,
    },
  });

  if (!existingReview) {
    throw new Error("REVIEW_NOT_FOUND");
  }

  if (existingReview.userId !== userId) {
    throw new Error("NOT_REVIEW_OWNER");
  }

  return prisma.$transaction(async (tx: TransactionClient) => {
    await tx.review.delete({
      where: {
        id: reviewId,
      },
    });

    await updateProductRating(tx, existingReview.productId);
  });
}

async function updateProductRating(
  tx: TransactionClient,
  productId: number,
) {
  const aggregate = await tx.review.aggregate({
    where: {
      productId,
    },

    _avg: {
      rating: true,
    },

    _count: {
      rating: true,
    },
  });

  const averageRating = aggregate._avg.rating ?? 0;

  const reviewCount = aggregate._count.rating ?? 0;

  await tx.product.update({
    where: {
      id: productId,
    },

    data: {
      rating: Number(averageRating.toFixed(1)),
      reviewCount,
    },
  });
}