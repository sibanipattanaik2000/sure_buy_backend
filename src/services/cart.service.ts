import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";import type {
  AddCartItemInput,
  UpdateCartItemInput,
} from "../validators/cart.validator";

const cartInclude = {
  items: {
    orderBy: {
      createdAt: "asc" as const,
    },

    include: {
      product: {
        select: {
          id: true,
          slug: true,
          brand: true,
          name: true,
          category: true,
          condition: true,
          price: true,
          originalPrice: true,
          warranty: true,
          rating: true,
          reviewCount: true,

          images: {
            orderBy: {
              position: "asc" as const,
            },
            take: 1,
            select: {
              id: true,
              url: true,
              altText: true,
            },
          },
        },
      },

      variant: {
        select: {
          id: true,
          storage: true,
          color: true,
          price: true,
          originalPrice: true,
          stock: true,

          images: {
            orderBy: {
              position: "asc" as const,
            },
            take: 1,
            select: {
              id: true,
              url: true,
              altText: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.CartInclude;

type CartWithItems = Prisma.CartGetPayload<{
  include: typeof cartInclude;
}>;

function decimalToNumber(value: Prisma.Decimal | number): number {
  return Number(value);
}

function getUnitPrice(item: CartWithItems["items"][number]): number {
  return decimalToNumber(
    item.variant?.price ?? item.product.price,
  );
}

function getItemImage(item: CartWithItems["items"][number]) {
  return item.variant?.images[0] ?? item.product.images[0] ?? null;
}

function serializeCart(cart: CartWithItems) {
  const items = cart.items.map((item) => {
    const unitPrice = getUnitPrice(item);
    const subtotal = unitPrice * item.quantity;

    return {
      id: item.id,

      productId: item.productId,
      variantId: item.variantId,

      quantity: item.quantity,

      unitPrice,
      subtotal,

      product: {
        id: item.product.id,
        slug: item.product.slug,
        brand: item.product.brand,
        name: item.product.name,
        category: item.product.category,
        condition: item.product.condition,

        price: decimalToNumber(item.product.price),
        originalPrice: decimalToNumber(
          item.product.originalPrice,
        ),

        warranty: item.product.warranty,

        rating: decimalToNumber(item.product.rating),
        reviewCount: item.product.reviewCount,

        image: getItemImage(item),
      },

      variant: item.variant
        ? {
            id: item.variant.id,
            storage: item.variant.storage,
            color: item.variant.color,

            price: decimalToNumber(item.variant.price),
            originalPrice: decimalToNumber(
              item.variant.originalPrice,
            ),

            stock: item.variant.stock,

            image: item.variant.images[0] ?? null,
          }
        : null,
    };
  });

  const subtotal = items.reduce(
    (total, item) => total + item.subtotal,
    0,
  );

  const totalQuantity = items.reduce(
    (total, item) => total + item.quantity,
    0,
  );

  return {
    id: cart.id,
    userId: cart.userId,

    items,

    summary: {
      itemCount: items.length,
      totalQuantity,
      subtotal: Number(subtotal.toFixed(2)),
    },

    createdAt: cart.createdAt,
    updatedAt: cart.updatedAt,
  };
}

async function getOrCreateCart(userId: string) {
  return prisma.cart.upsert({
    where: {
      userId,
    },

    create: {
      userId,
    },

    update: {},

    include: cartInclude,
  });
}

export async function getUserCart(userId: string) {
  const cart = await getOrCreateCart(userId);

  return serializeCart(cart);
}

export async function addItemToCart(
  userId: string,
  input: AddCartItemInput,
) {
  const product = await prisma.product.findFirst({
    where: {
      id: input.productId,
      active: true,
    },

    select: {
      id: true,
      variants: {
        select: {
          id: true,
          stock: true,
        },
      },
    },
  });

  if (!product) {
    throw new Error("PRODUCT_NOT_FOUND");
  }

  let variantId: number | null =
    input.variantId ?? null;

  if (variantId !== null) {
    const variant = product.variants.find(
      (item) => item.id === variantId,
    );

    if (!variant) {
      throw new Error("VARIANT_NOT_FOUND");
    }

    if (variant.stock <= 0) {
      throw new Error("VARIANT_OUT_OF_STOCK");
    }
  } else if (product.variants.length > 0) {
    throw new Error("VARIANT_REQUIRED");
  }

  const cart = await prisma.cart.upsert({
    where: {
      userId,
    },

    create: {
      userId,
    },

    update: {},
  });

  const existingItem = await prisma.cartItem.findFirst({
    where: {
      cartId: cart.id,
      productId: input.productId,
      variantId,
    },
  });

  const requestedQuantity =
    (existingItem?.quantity ?? 0) + input.quantity;

  if (variantId !== null) {
    const variant = product.variants.find(
      (item) => item.id === variantId,
    );

    if (!variant) {
      throw new Error("VARIANT_NOT_FOUND");
    }

    if (requestedQuantity > variant.stock) {
      throw new Error("INSUFFICIENT_STOCK");
    }
  }

  if (existingItem) {
    await prisma.cartItem.update({
      where: {
        id: existingItem.id,
      },

      data: {
        quantity: requestedQuantity,
      },
    });
  } else {
    await prisma.cartItem.create({
      data: {
        cartId: cart.id,
        productId: input.productId,
        variantId,
        quantity: input.quantity,
      },
    });
  }

  return getUserCart(userId);
}

export async function updateCartItem(
  userId: string,
  itemId: string,
  input: UpdateCartItemInput,
) {
  const item = await prisma.cartItem.findFirst({
    where: {
      id: itemId,

      cart: {
        userId,
      },
    },

    include: {
      variant: {
        select: {
          id: true,
          stock: true,
        },
      },

      product: {
        select: {
          id: true,
          active: true,
        },
      },
    },
  });

  if (!item) {
    throw new Error("CART_ITEM_NOT_FOUND");
  }

  if (!item.product.active) {
    throw new Error("PRODUCT_UNAVAILABLE");
  }

  if (item.variant) {
    if (item.variant.stock <= 0) {
      throw new Error("VARIANT_OUT_OF_STOCK");
    }

    if (input.quantity > item.variant.stock) {
      throw new Error("INSUFFICIENT_STOCK");
    }
  }

  await prisma.cartItem.update({
    where: {
      id: item.id,
    },

    data: {
      quantity: input.quantity,
    },
  });

  return getUserCart(userId);
}

export async function removeCartItem(
  userId: string,
  itemId: string,
) {
  const item = await prisma.cartItem.findFirst({
    where: {
      id: itemId,

      cart: {
        userId,
      },
    },

    select: {
      id: true,
    },
  });

  if (!item) {
    throw new Error("CART_ITEM_NOT_FOUND");
  }

  await prisma.cartItem.delete({
    where: {
      id: item.id,
    },
  });

  return getUserCart(userId);
}

export async function clearUserCart(userId: string) {
  const cart = await prisma.cart.findUnique({
    where: {
      userId,
    },

    select: {
      id: true,
    },
  });

  if (!cart) {
    return getUserCart(userId);
  }

  await prisma.cartItem.deleteMany({
    where: {
      cartId: cart.id,
    },
  });

  return getUserCart(userId);
}

export async function validateUserCart(userId: string) {
  const cart = await prisma.cart.findUnique({
    where: {
      userId,
    },

    include: {
      items: {
        include: {
          product: {
            select: {
              id: true,
              active: true,
              price: true,
            },
          },

          variant: {
            select: {
              id: true,
              price: true,
              stock: true,
            },
          },
        },
      },
    },
  });

  if (!cart || cart.items.length === 0) {
    return {
      valid: true,
      issues: [],
      cart: await getUserCart(userId),
    };
  }

  const issues: Array<{
    itemId: string;
    code: string;
    message: string;
  }> = [];

  for (const item of cart.items) {
    if (!item.product.active) {
      issues.push({
        itemId: item.id,
        code: "PRODUCT_UNAVAILABLE",
        message: "This product is no longer available.",
      });

      continue;
    }

    if (item.variant) {
      if (item.variant.stock <= 0) {
        issues.push({
          itemId: item.id,
          code: "OUT_OF_STOCK",
          message: "This item is out of stock.",
        });

        continue;
      }

      if (item.quantity > item.variant.stock) {
        issues.push({
          itemId: item.id,
          code: "INSUFFICIENT_STOCK",
          message: `Only ${item.variant.stock} item(s) are currently available.`,
        });
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    cart: await getUserCart(userId),
  };
}