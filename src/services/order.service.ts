import { Prisma, OrderStatus, PaymentStatus } from "@prisma/client";
import { prisma } from "../config/prisma";
import type { CreateOrderInput } from "../validators/order.validator";

type TransactionClient = Prisma.TransactionClient;

const ORDER_INCLUDE = {
  items: {
    orderBy: {
      createdAt: "asc" as const,
    },
    select: {
      id: true,
      productId: true,
      variantId: true,

      productName: true,
      brand: true,
      category: true,
      condition: true,

      storage: true,
      color: true,
      imageUrl: true,

      unitPrice: true,
      originalPrice: true,
      quantity: true,
      subtotal: true,

      createdAt: true,
    },
  },
} satisfies Prisma.OrderInclude;

type OrderWithItems = Prisma.OrderGetPayload<{
  include: typeof ORDER_INCLUDE;
}>;

function decimalToNumber(value: Prisma.Decimal | number): number {
  return Number(value);
}

function serializeOrder(order: OrderWithItems) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,

    userId: order.userId,

    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,

    subtotal: decimalToNumber(order.subtotal),
    deliveryAmount: decimalToNumber(order.deliveryAmount),
    discountAmount: decimalToNumber(order.discountAmount),
    totalAmount: decimalToNumber(order.totalAmount),

    currency: order.currency,

    shippingAddress: {
      fullName: order.shippingFullName,
      phone: order.shippingPhone,
      addressLine1: order.shippingAddressLine1,
      addressLine2: order.shippingAddressLine2,
      area: order.shippingArea,
      city: order.shippingCity,
      state: order.shippingState,
      postalCode: order.shippingPostalCode,
      country: order.shippingCountry,
      landmark: order.shippingLandmark,
    },

    items: order.items.map((item) => ({
      id: item.id,

      productId: item.productId,
      variantId: item.variantId,

      productName: item.productName,
      brand: item.brand,
      category: item.category,
      condition: item.condition,

      storage: item.storage,
      color: item.color,

      imageUrl: item.imageUrl,

      unitPrice: decimalToNumber(item.unitPrice),
      originalPrice: decimalToNumber(item.originalPrice),

      quantity: item.quantity,
      subtotal: decimalToNumber(item.subtotal),

      createdAt: item.createdAt,
    })),

    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

function generateOrderNumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase();

  const random = Math.random()
    .toString(36)
    .substring(2, 8)
    .toUpperCase();

  return `SB-${timestamp}-${random}`;
}

async function createUniqueOrderNumber(
  tx: TransactionClient,
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const orderNumber = generateOrderNumber();

    const existing = await tx.order.findUnique({
      where: {
        orderNumber,
      },
      select: {
        id: true,
      },
    });

    if (!existing) {
      return orderNumber;
    }
  }

  throw new Error("ORDER_NUMBER_GENERATION_FAILED");
}

export async function createOrder(
  userId: string,
  input: CreateOrderInput,
) {
  return prisma.$transaction(
    async (tx) => {
      /*
       * 1. Verify that the address belongs to the
       *    authenticated user.
       *
       * We copy the address into the order rather than
       * storing only addressId. This protects historical
       * orders if the user later edits/deletes the address.
       */
      const address = await tx.address.findFirst({
        where: {
          id: input.addressId,
          userId,
        },
      });

      if (!address) {
        throw new Error("ADDRESS_NOT_FOUND");
      }

      /*
       * 2. Get the user's cart and all current product data.
       *
       * Prices are deliberately read from the database.
       * Never trust prices sent by the frontend.
       */
      const cart = await tx.cart.findUnique({
        where: {
          userId,
        },
        include: {
          items: {
            orderBy: {
              createdAt: "asc",
            },

            include: {
            product: {
  include: {
    images: {
      orderBy: {
        position: "asc",
      },
      take: 1,
    },

    variants: {
      select: {
        id: true,
        productId: true,
        stock: true,
      },
    },
  },
},

              variant: {
                include: {
                  images: {
                    orderBy: {
                      position: "asc",
                    },
                    take: 1,
                  },
                },
              },
            },
          },
        },
      });

      if (!cart || cart.items.length === 0) {
        throw new Error("CART_EMPTY");
      }

      /*
       * 3. Validate every cart item before creating
       *    anything.
       */
      for (const item of cart.items) {
        if (!item.product.active) {
          throw new Error("PRODUCT_UNAVAILABLE");
        }

        if (item.quantity <= 0) {
          throw new Error("INVALID_CART_QUANTITY");
        }

        /*
         * If a product has variants, the cart item must
         * contain a valid variant.
         */
        if (item.product.variants.length > 0 && !item.variant) {
          throw new Error("VARIANT_REQUIRED");
        }

        if (item.variant) {
          if (item.variant.productId !== item.productId) {
            throw new Error("VARIANT_INVALID");
          }

          if (item.variant.stock <= 0) {
            throw new Error("OUT_OF_STOCK");
          }

          if (item.quantity > item.variant.stock) {
            throw new Error("INSUFFICIENT_STOCK");
          }
        }
      }

      /*
       * 4. Calculate all amounts from current database
       *    prices.
       */
      let subtotal = 0;

      const orderItems = cart.items.map((item) => {
        const unitPrice = decimalToNumber(
          item.variant?.price ?? item.product.price,
        );

        const originalPrice = decimalToNumber(
          item.variant?.originalPrice ??
            item.product.originalPrice,
        );

        const itemSubtotal = Number(
          (unitPrice * item.quantity).toFixed(2),
        );

        subtotal += itemSubtotal;

        const imageUrl =
          item.variant?.images[0]?.url ??
          item.product.images[0]?.url ??
          null;

        return {
          cartItemId: item.id,

          productId: item.productId,
          variantId: item.variantId,

          productName: item.product.name,
          brand: item.product.brand,
          category: item.product.category,
          condition: item.product.condition,

          storage: item.variant?.storage ?? null,
          color: item.variant?.color ?? null,

          imageUrl,

          unitPrice,
          originalPrice,

          quantity: item.quantity,
          subtotal: itemSubtotal,
        };
      });

      subtotal = Number(subtotal.toFixed(2));

      /*
       * Delivery and discount are currently zero because
       * there is no shipping-charge / coupon engine in the
       * current schema.
       *
       * We will add those independently later rather than
       * hard-coding fake business logic.
       */
      const deliveryAmount = 0;
      const discountAmount = 0;

      const totalAmount = Number(
        (
          subtotal +
          deliveryAmount -
          discountAmount
        ).toFixed(2),
      );

      /*
       * 5. Generate a unique order number.
       */
      const orderNumber =
        await createUniqueOrderNumber(tx);

      /*
       * 6. Create the order and snapshot the shipping
       *    address.
       */
      const order = await tx.order.create({
        data: {
          orderNumber,

          userId,

          status: OrderStatus.PENDING,

          paymentStatus: PaymentStatus.PENDING,

          paymentMethod: input.paymentMethod,

          subtotal,
          deliveryAmount,
          discountAmount,
          totalAmount,

          currency: "INR",

          shippingFullName: address.fullName,
          shippingPhone: address.phone,

          shippingAddressLine1:
            address.addressLine1,

          shippingAddressLine2:
            address.addressLine2,

          shippingCity: address.city,
          shippingState: address.state,

          shippingPostalCode:
            address.postalCode,

          shippingCountry:
            address.country,

          shippingLandmark:
            address.landmark,

          items: {
            create: orderItems.map((item) => ({
              productId: item.productId,
              variantId: item.variantId,

              productName: item.productName,
              brand: item.brand,
              category: item.category,
              condition: item.condition,

              storage: item.storage,
              color: item.color,

              imageUrl: item.imageUrl,

              unitPrice: item.unitPrice,
              originalPrice: item.originalPrice,

              quantity: item.quantity,
              subtotal: item.subtotal,
            })),
          },
        },

        include: ORDER_INCLUDE,
      });

      /*
       * 7. Decrease stock atomically.
       *
       * IMPORTANT:
       *
       * We do not simply:
       *
       *   stock = stock - quantity
       *
       * after reading the stock.
       *
       * Instead we require:
       *
       *   stock >= requested quantity
       *
       * inside the UPDATE itself.
       *
       * This protects against overselling when two
       * customers attempt to buy the final units at
       * approximately the same time.
       */
      for (const item of orderItems) {
        if (item.variantId === null) {
          continue;
        }

        const updatedVariant =
          await tx.productVariant.updateMany({
            where: {
              id: item.variantId,

              productId: item.productId,

              stock: {
                gte: item.quantity,
              },
            },

            data: {
              stock: {
                decrement: item.quantity,
              },
            },
          });

        if (updatedVariant.count !== 1) {
          throw new Error("INSUFFICIENT_STOCK");
        }
      }

      /*
       * 8. Clear the purchased cart.
       *
       * Because this is inside the same transaction,
       * failure anywhere above automatically rolls back
       * the order, stock changes and cart changes.
       */
      await tx.cartItem.deleteMany({
        where: {
          cartId: cart.id,
        },
      });

      return serializeOrder(order);
    },
    {
      /*
       * Serializable isolation gives the transaction the
       * strongest consistency level supported by PostgreSQL.
       */
      isolationLevel:
        Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}

export async function getOrderById(
  userId: string,
  orderId: string,
) {
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      userId,
    },
    include: ORDER_INCLUDE,
  });

  if (!order) {
    throw new Error("ORDER_NOT_FOUND");
  }

  return serializeOrder(order);
}

export async function getUserOrders(
  userId: string,
) {
  const orders = await prisma.order.findMany({
    where: {
      userId,
    },

    orderBy: {
      createdAt: "desc",
    },

    include: ORDER_INCLUDE,
  });

  return orders.map(serializeOrder);
}

export async function cancelOrder(
  userId: string,
  orderId: string,
) {
  return prisma.$transaction(
    async (tx) => {
      const order = await tx.order.findFirst({
        where: {
          id: orderId,
          userId,
        },

        include: {
          items: true,
        },
      });

      if (!order) {
        throw new Error("ORDER_NOT_FOUND");
      }

      /*
       * Only orders that have not progressed into
       * processing/shipping/delivery can be cancelled
       * through the customer API.
       */
      const cancellableStatuses: OrderStatus[] = [
        OrderStatus.PENDING,
        OrderStatus.CONFIRMED,
      ];

      if (
        !cancellableStatuses.includes(
          order.status,
        )
      ) {
        throw new Error("ORDER_CANNOT_BE_CANCELLED");
      }

      /*
       * Restore stock for variant-based products.
       */
      for (const item of order.items) {
        if (item.variantId === null) {
          continue;
        }

        await tx.productVariant.update({
          where: {
            id: item.variantId,
          },

          data: {
            stock: {
              increment: item.quantity,
            },
          },
        });
      }

      const paymentStatus =
        order.paymentStatus ===
        PaymentStatus.PAID
          ? PaymentStatus.REFUNDED
          : order.paymentStatus;

      const updatedOrder =
        await tx.order.update({
          where: {
            id: order.id,
          },

          data: {
            status: OrderStatus.CANCELLED,
            paymentStatus,
          },

          include: ORDER_INCLUDE,
        });

      return serializeOrder(updatedOrder);
    },
    {
      isolationLevel:
        Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}