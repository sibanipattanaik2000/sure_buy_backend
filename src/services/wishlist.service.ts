import { prisma } from "../config/prisma";
import { MediaType } from "@prisma/client";
const WISHLIST_PRODUCT_SELECT = {
  id: true,
  slug: true,
  name: true,
  brand: true,
  category: true,
  condition: true,
  price: true,
  originalPrice: true,
  warranty: true,
  rating: true,
  reviewCount: true,
  active: true,
  images: {
   where: {
  type: MediaType.IMAGE,
},
    orderBy: {
      position: "asc" as const,
    },
    take: 1,
    select: {
      id: true,
      url: true,
      altText: true,
      position: true,
    },
  },
};

function serializeWishlistItem(item: any) {
  const product = item.product;

  return {
    id: item.id,
    productId: product.id,
    slug: product.slug,
    name: product.name,
    brand: product.brand,
    category: product.category,
    condition: product.condition,
    price: Number(product.price),
    originalPrice: Number(product.originalPrice),
    warranty: product.warranty,
    rating: Number(product.rating),
    reviewCount: product.reviewCount,
    image: product.images?.[0]?.url ?? null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export async function getWishlist(userId: string) {
  const items = await prisma.wishlistItem.findMany({
    where: {
      userId,
      product: {
        active: true,
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    include: {
      product: {
        select: WISHLIST_PRODUCT_SELECT,
      },
    },
  });

  return items.map(serializeWishlistItem);
}

export async function addWishlistItem(
  userId: string,
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
    throw new Error("PRODUCT_NOT_FOUND");
  }

  const item = await prisma.wishlistItem.upsert({
    where: {
      userId_productId: {
        userId,
        productId,
      },
    },
    create: {
      userId,
      productId,
    },
    update: {},
    include: {
      product: {
        select: WISHLIST_PRODUCT_SELECT,
      },
    },
  });

  return serializeWishlistItem(item);
}

export async function removeWishlistItem(
  userId: string,
  productId: number,
) {
  const existing = await prisma.wishlistItem.findUnique({
    where: {
      userId_productId: {
        userId,
        productId,
      },
    },
    select: {
      id: true,
    },
  });

  if (!existing) {
    throw new Error("WISHLIST_ITEM_NOT_FOUND");
  }

  await prisma.wishlistItem.delete({
    where: {
      id: existing.id,
    },
  });
}

export async function clearWishlist(userId: string) {
  await prisma.wishlistItem.deleteMany({
    where: {
      userId,
    },
  });
}

export async function isProductWishlisted(
  userId: string,
  productId: number,
) {
  const item = await prisma.wishlistItem.findUnique({
    where: {
      userId_productId: {
        userId,
        productId,
      },
    },
    select: {
      id: true,
    },
  });

  return Boolean(item);
}