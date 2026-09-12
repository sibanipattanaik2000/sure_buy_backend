import {
  DeleteObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

import { prisma } from "../config/prisma";
import { r2Client } from "../config/r2";
import { env } from "../config/env";

interface ReviewInput {
  rating: number;
  comment: string;
}

export interface ReviewMediaInput {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  size: number;
  type: "IMAGE" | "VIDEO";
}

type TransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_VIDEO_SIZE = 50 * 1024 * 1024;
const MAX_IMAGES = 5;

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const ALLOWED_VIDEO_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

function getExtension(
  originalName: string,
  mimeType: string,
): string {
  const extension = originalName
    .split(".")
    .pop()
    ?.toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  if (extension) {
    return extension;
  }

  const mimeExtensionMap: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
  };

  return mimeExtensionMap[mimeType] || "bin";
}

function validateMedia(media: ReviewMediaInput[]) {
  const images = media.filter(
    (item) => item.type === "IMAGE",
  );

  const videos = media.filter(
    (item) => item.type === "VIDEO",
  );

  if (images.length > MAX_IMAGES) {
    throw new Error("TOO_MANY_IMAGES");
  }

  if (videos.length > 1) {
    throw new Error("TOO_MANY_VIDEOS");
  }

  for (const item of media) {
    if (item.type === "IMAGE") {
      if (!ALLOWED_IMAGE_TYPES.has(item.mimeType)) {
        throw new Error("INVALID_IMAGE_TYPE");
      }

      if (item.size > MAX_IMAGE_SIZE) {
        throw new Error("IMAGE_TOO_LARGE");
      }
    }

    if (item.type === "VIDEO") {
      if (!ALLOWED_VIDEO_TYPES.has(item.mimeType)) {
        throw new Error("INVALID_VIDEO_TYPE");
      }

      if (item.size > MAX_VIDEO_SIZE) {
        throw new Error("VIDEO_TOO_LARGE");
      }
    }
  }
}

async function uploadReviewMedia(
  reviewId: number,
  media: ReviewMediaInput[],
) {
  const uploaded: {
    key: string;
    url: string;
  }[] = [];

  try {
    for (let index = 0; index < media.length; index++) {
      const item = media[index];

      if (!item) {
        continue;
      }

      const extension = getExtension(
        item.originalName,
        item.mimeType,
      );

      const key =
        `reviews/${reviewId}/${Date.now()}-${index}-${randomUUID()}.${extension}`;

      await r2Client.send(
        new PutObjectCommand({
          Bucket: env.R2_BUCKET_NAME,
          Key: key,
          Body: item.buffer,
          ContentType: item.mimeType,
          ContentLength: item.size,
        }),
      );

      uploaded.push({
        key,
        url: `${env.R2_PUBLIC_BASE_URL}/${key}`,
      });
    }

    return uploaded;
  } catch (error) {
    await Promise.allSettled(
      uploaded.map((item) =>
        r2Client.send(
          new DeleteObjectCommand({
            Bucket: env.R2_BUCKET_NAME,
            Key: item.key,
          }),
        ),
      ),
    );

    throw error;
  }
}

async function deleteReviewMediaFromR2(
  keys: string[],
) {
  if (keys.length === 0) {
    return;
  }

  await Promise.allSettled(
    keys.map((key) =>
      r2Client.send(
        new DeleteObjectCommand({
          Bucket: env.R2_BUCKET_NAME,
          Key: key,
        }),
      ),
    ),
  );
}

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
        media: {
          orderBy: {
            position: "asc",
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
      hasNextPage:
        page < Math.ceil(total / limit),
      hasPreviousPage: page > 1,
    },
  };
}

export async function getUserProductReview(
  userId: string,
  productId: number,
) {
  return prisma.review.findUnique({
    where: {
      productId_userId: {
        productId,
        userId,
      },
    },
    include: {
      media: {
        orderBy: {
          position: "asc",
        },
      },
    },
  });
}

export async function createProductReview(
  userId: string,
  productId: number,
  orderId: string,
  input: ReviewInput,
  media: ReviewMediaInput[] = [],
) {
  if (
    !Number.isInteger(input.rating) ||
    input.rating < 1 ||
    input.rating > 5
  ) {
    throw new Error("INVALID_RATING");
  }

  const comment = input.comment.trim();

  if (!comment) {
    throw new Error("REVIEW_COMMENT_REQUIRED");
  }

  if (comment.length > 1000) {
    throw new Error("REVIEW_TOO_LONG");
  }

  validateMedia(media);

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

  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      userId,
    },
    select: {
      id: true,
      status: true,
      items: {
        where: {
          productId,
        },
        select: {
          id: true,
          productId: true,
          quantity: true,
        },
      },
    },
  });

  if (!order) {
    throw new Error("ORDER_NOT_FOUND");
  }

  if (order.status !== "DELIVERED") {
    throw new Error(
      "REVIEW_AFTER_DELIVERY_ONLY",
    );
  }

  const item = order.items[0];

  if (!item) {
    throw new Error("PRODUCT_NOT_PURCHASED");
  }

  const existingReview =
    await prisma.review.findUnique({
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

  const review = await prisma.$transaction(
    async (tx: TransactionClient) => {
      const createdReview =
        await tx.review.create({
          data: {
            productId,
            userId,
            rating: input.rating,
            comment,
            verifiedPurchase: true,
          },
        });

      await updateProductRating(
        tx,
        productId,
      );

      return createdReview;
    },
  );

  let uploadedMedia: {
    key: string;
    url: string;
  }[] = [];

  try {
    if (media.length > 0) {
      uploadedMedia =
        await uploadReviewMedia(
          review.id,
          media,
        );

      await prisma.reviewMedia.createMany({
        data: uploadedMedia
          .map((item, index) => {
            const sourceMedia = media[index];

            if (!sourceMedia) {
              return null;
            }

            return {
              reviewId: review.id,
              url: item.url,
              key: item.key,
              mimeType:
                sourceMedia.mimeType,
              size: sourceMedia.size,
              type: sourceMedia.type,
              position: index,
            };
          })
          .filter(
            (
              item,
            ): item is {
              reviewId: number;
              url: string;
              key: string;
              mimeType: string;
              size: number;
              type: "IMAGE" | "VIDEO";
              position: number;
            } => item !== null,
          ),
      });
    }

    const finalReview =
      await prisma.review.findUnique({
        where: {
          id: review.id,
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
          media: {
            orderBy: {
              position: "asc",
            },
          },
        },
      });

    return finalReview;
  } catch (error) {
    await deleteReviewMediaFromR2(
      uploadedMedia.map(
        (item) => item.key,
      ),
    );

    await prisma.$transaction(
      async (tx: TransactionClient) => {
        await tx.review.delete({
          where: {
            id: review.id,
          },
        });

        await updateProductRating(
          tx,
          productId,
        );
      },
    );

    throw error;
  }
}

export async function updateProductReview(
  userId: string,
  reviewId: number,
  input: Partial<ReviewInput>,
) {
  const existingReview =
    await prisma.review.findUnique({
      where: {
        id: reviewId,
      },
    });

  if (!existingReview) {
    throw new Error(
      "REVIEW_NOT_FOUND",
    );
  }

  if (existingReview.userId !== userId) {
    throw new Error(
      "NOT_REVIEW_OWNER",
    );
  }

  if (
    input.rating !== undefined &&
    (!Number.isInteger(input.rating) ||
      input.rating < 1 ||
      input.rating > 5)
  ) {
    throw new Error("INVALID_RATING");
  }

  if (input.comment !== undefined) {
    const trimmedComment =
      input.comment.trim();

    if (!trimmedComment) {
      throw new Error(
        "REVIEW_COMMENT_REQUIRED",
      );
    }

    if (trimmedComment.length > 1000) {
      throw new Error(
        "REVIEW_TOO_LONG",
      );
    }

    input.comment = trimmedComment;
  }

  return prisma.$transaction(
    async (tx: TransactionClient) => {
      const review =
        await tx.review.update({
          where: {
            id: reviewId,
          },
          data: {
            ...(input.rating !== undefined
              ? {
                  rating: input.rating,
                }
              : {}),
            ...(input.comment !== undefined
              ? {
                  comment:
                    input.comment,
                }
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
            media: {
              orderBy: {
                position: "asc",
              },
            },
          },
        });

      await updateProductRating(
        tx,
        existingReview.productId,
      );

      return review;
    },
  );
}

export async function deleteProductReview(
  userId: string,
  reviewId: number,
) {
  const existingReview =
    await prisma.review.findUnique({
      where: {
        id: reviewId,
      },
      include: {
        media: true,
      },
    });

  if (!existingReview) {
    throw new Error(
      "REVIEW_NOT_FOUND",
    );
  }

  if (existingReview.userId !== userId) {
    throw new Error(
      "NOT_REVIEW_OWNER",
    );
  }

  const mediaKeys =
    existingReview.media.map(
      (item) => item.key,
    );

  await prisma.$transaction(
    async (tx: TransactionClient) => {
      await tx.review.delete({
        where: {
          id: reviewId,
        },
      });

      await updateProductRating(
        tx,
        existingReview.productId,
      );
    },
  );

  await deleteReviewMediaFromR2(
    mediaKeys,
  );
}

async function updateProductRating(
  tx: TransactionClient,
  productId: number,
) {
  const aggregate =
    await tx.review.aggregate({
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

  const averageRating =
    aggregate._avg.rating ?? 0;

  const reviewCount =
    aggregate._count.rating ?? 0;

  await tx.product.update({
    where: {
      id: productId,
    },
    data: {
      rating: Number(
        averageRating.toFixed(1),
      ),
      reviewCount,
    },
  });
}