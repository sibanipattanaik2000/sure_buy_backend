import {
  Prisma,
  OrderStatus,
  PaymentStatus,
} from "@prisma/client";
import {
  initiateRazorpayRefund,
} from "./payment.service";
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

      variant: {
        select: {
          images: {
            where: {
              type: "IMAGE",
            },
            orderBy: {
              position: "asc",
            },
            take: 1,
          },
        },
      },

      product: {
        select: {
          images: {
            where: {
              type: "IMAGE",
            },
            orderBy: {
              position: "asc",
            },
            take: 1,
          },
        },
      },

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

      imageUrl:
        item.imageUrl &&
        !/\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(item.imageUrl)
          ? item.imageUrl
          : (item.variant?.images[0]?.url ??
            item.product?.images[0]?.url ??
            null),

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

  return `PB-${timestamp}-${random}`;
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
       * =====================================================
       * 1. Validate address ownership
       * =====================================================
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
       * =====================================================
       * 2. Load cart with CURRENT database product data
       * =====================================================
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
                    where: {
                      type: "IMAGE",
                    },
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
                    where: {
                      type: "IMAGE",
                    },
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
       * =====================================================
       * 3. Validate cart
       *
       * IMPORTANT:
       *
       * We CHECK stock here.
       *
       * We DO NOT CHANGE stock here.
       * =====================================================
       */

      for (const item of cart.items) {
        if (!item.product.active) {
          throw new Error("PRODUCT_UNAVAILABLE");
        }

        if (item.quantity <= 0) {
          throw new Error("INVALID_CART_QUANTITY");
        }

        /*
         * Variant products must always have a valid variant.
         */

        if (
          item.product.variants.length > 0 &&
          !item.variant
        ) {
          throw new Error("VARIANT_REQUIRED");
        }

        if (item.variant) {
          if (
            item.variant.productId !==
            item.productId
          ) {
            throw new Error("VARIANT_INVALID");
          }

          /*
           * Stock is ONLY read here.
           *
           * No decrement.
           */

          if (item.variant.stock <= 0) {
            throw new Error("OUT_OF_STOCK");
          }

          if (
            item.quantity >
            item.variant.stock
          ) {
            throw new Error("INSUFFICIENT_STOCK");
          }
        }
      }

      /*
       * =====================================================
       * 4. Calculate order totals from DB prices
       * =====================================================
       */

      let subtotal = 0;

      const orderItems = cart.items.map(
        (item) => {
          const unitPrice =
            decimalToNumber(
              item.variant?.price ??
                item.product.price,
            );

          const originalPrice =
            decimalToNumber(
              item.variant?.originalPrice ??
                item.product.originalPrice,
            );

          const itemSubtotal = Number(
            (
              unitPrice *
              item.quantity
            ).toFixed(2),
          );

          subtotal += itemSubtotal;

          const imageUrl =
            item.variant?.images[0]?.url ??
            item.product.images[0]?.url ??
            null;

          return {
            productId:
              item.productId,

            variantId:
              item.variantId,

            productName:
              item.product.name,

            brand:
              item.product.brand,

            category:
              item.product.category,

            condition:
              item.product.condition,

            storage:
              item.variant?.storage ??
              null,

            color:
              item.variant?.color ??
              null,

            imageUrl,

            unitPrice,

            originalPrice,

            quantity:
              item.quantity,

            subtotal:
              itemSubtotal,
          };
        },
      );

      subtotal = Number(
        subtotal.toFixed(2),
      );

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
       * =====================================================
       * 5. Generate order number
       * =====================================================
       */

      const orderNumber =
        await createUniqueOrderNumber(tx);

      /*
       * =====================================================
       * 6. CREATE ORDER
       *
       * CRITICAL:
       *
       * stockReserved = false
       *
       * NO stock mutation happens here.
       *
       * COD is ALSO PENDING because COD requires the
       * ₹500 Razorpay advance in the current frontend.
       * =====================================================
       */

      const order =
        await tx.order.create({
          data: {
            orderNumber,

            userId,

            status:
              OrderStatus.PENDING,

            paymentStatus:
              PaymentStatus.PENDING,

            paymentMethod:
              input.paymentMethod,

            stockReserved:
              false,

            subtotal,

            deliveryAmount,

            discountAmount,

            totalAmount,

            currency: "INR",

            shippingFullName:
              address.fullName,

            shippingPhone:
              address.phone,

            shippingAddressLine1:
              address.addressLine1,

            shippingAddressLine2:
              address.addressLine2,

            shippingArea:
              address.landmark,

            shippingCity:
              address.city,

            shippingState:
              address.state,

            shippingPostalCode:
              address.postalCode,

            shippingCountry:
              address.country,

            shippingLandmark:
              address.landmark,

            items: {
              create:
                orderItems.map(
                  (item) => ({
                    productId:
                      item.productId,

                    variantId:
                      item.variantId,

                    productName:
                      item.productName,

                    brand:
                      item.brand,

                    category:
                      item.category,

                    condition:
                      item.condition,

                    storage:
                      item.storage,

                    color:
                      item.color,

                    imageUrl:
                      item.imageUrl,

                    unitPrice:
                      item.unitPrice,

                    originalPrice:
                      item.originalPrice,

                    quantity:
                      item.quantity,

                    subtotal:
                      item.subtotal,
                  }),
                ),
            },
          },

          include:
            ORDER_INCLUDE,
        });

      /*
       * =====================================================
       * IMPORTANT:
       *
       * THERE IS NO PRODUCTVARIANT.UPDATE HERE.
       *
       * Stock remains exactly as it was.
       * =====================================================
       */

      return serializeOrder(order);
    },
    {
      isolationLevel:
        Prisma.TransactionIsolationLevel.ReadCommitted,

      timeout: 15000,
    },
  );
}

export async function getOrderById(
  userId: string,
  orderId: string,
) {
  const order =
    await prisma.order.findFirst({
      where: {
        id: orderId,
        userId,
      },

      include:
        ORDER_INCLUDE,
    });

  if (!order) {
    throw new Error("ORDER_NOT_FOUND");
  }

  return serializeOrder(order);
}

export async function getUserOrders(
  userId: string,
) {
  const orders =
    await prisma.order.findMany({
      where: {
        userId,
      },

      orderBy: {
        createdAt: "desc",
      },

      include:
        ORDER_INCLUDE,
    });

  return orders.map(
    serializeOrder,
  );
}

export async function cancelOrder(
  userId: string,
  orderId: string,
) {
  /*
   * Refund information is collected inside the transaction,
   * but the actual Razorpay API call happens AFTER the
   * transaction commits.
   *
   * This prevents a slow/failed Razorpay request from holding
   * a PostgreSQL transaction open.
   */
  let refundRequired:
    | {
        paymentId: string;
        providerPaymentId: string;
        amount: number;
        reason: string;
      }
    | undefined;

  const result = await prisma.$transaction(
    async (tx) => {
      const order =
        await tx.order.findFirst({
          where: {
            id: orderId,
            userId,
          },
          include: {
            items: true,
            payments: {
              orderBy: {
                createdAt: "desc",
              },
            },
          },
        });

      if (!order) {
        throw new Error(
          "ORDER_NOT_FOUND",
        );
      }

      const cancellableStatuses:
        OrderStatus[] = [
          OrderStatus.PENDING,
          OrderStatus.CONFIRMED,
        ];

      if (
        !cancellableStatuses.includes(
          order.status,
        )
      ) {
        throw new Error(
          "ORDER_CANNOT_BE_CANCELLED",
        );
      }

      /*
       * =====================================================
       * FIND THE RELEVANT PAYMENT
       * =====================================================
       *
       * The latest payment belonging to this order is used.
       */

      const payment =
        order.payments[0] ?? null;

      /*
       * =====================================================
       * DETERMINE WHETHER A REAL REFUND IS REQUIRED
       * =====================================================
       *
       * PAID:
       *   Full payment was captured.
       *
       * PARTIALLY_PAID:
       *   COD ₹500 advance was captured.
       *
       * REFUND_PENDING:
       *   A refund has already been requested.
       *
       * REFUNDED:
       *   Already completely refunded.
       *
       * PARTIALLY_REFUNDED:
       *   Some amount has already been refunded.
       */

      const paymentNeedsRefund =
        order.paymentStatus ===
          PaymentStatus.PAID ||
        order.paymentStatus ===
          PaymentStatus.PARTIALLY_PAID;

      const refundAlreadyPending =
        order.paymentStatus ===
        PaymentStatus.REFUND_PENDING;

      const alreadyRefunded =
        order.paymentStatus ===
          PaymentStatus.REFUNDED ||
        order.paymentStatus ===
          PaymentStatus.PARTIALLY_REFUNDED;

      /*
       * =====================================================
       * PAID ORDER MUST HAVE A REAL PAYMENT RECORD
       * =====================================================
       */

      if (
        paymentNeedsRefund &&
        !payment
      ) {
        throw new Error(
          "PAYMENT_RECORD_NOT_FOUND",
        );
      }

      /*
       * =====================================================
       * PAID ORDER MUST HAVE RAZORPAY PAYMENT ID
       * =====================================================
       *
       * Without providerPaymentId we cannot safely create
       * a Razorpay refund.
       *
       * Therefore DO NOT cancel the order in this situation.
       */

      if (
        paymentNeedsRefund &&
        payment &&
        !payment.providerPaymentId
      ) {
        throw new Error(
          "RAZORPAY_PAYMENT_ID_NOT_FOUND",
        );
      }

      /*
       * =====================================================
       * RESTORE STOCK
       * =====================================================
       *
       * Stock is restored ONLY if this order previously
       * deducted stock.
       *
       * stockReserved=true means the payment was successfully
       * processed and stock was decremented.
       */

      if (order.stockReserved) {
        for (const item of order.items) {
          if (
            item.variantId === null
          ) {
            continue;
          }

          await tx.productVariant.update({
            where: {
              id: item.variantId,
            },

            data: {
              stock: {
                increment:
                  item.quantity,
              },
            },
          });
        }

        await tx.order.update({
          where: {
            id: order.id,
          },

          data: {
            stockReserved: false,
          },
        });
      }

      /*
       * =====================================================
       * PAYMENT STATE
       * =====================================================
       */

      let nextPaymentStatus =
        order.paymentStatus;

      /*
       * A captured payment requires a real Razorpay refund.
       *
       * We mark REFUND_PENDING inside the transaction first.
       * The actual Razorpay refund request happens after commit.
       */

      if (
        paymentNeedsRefund &&
        payment
      ) {
        nextPaymentStatus =
          PaymentStatus.REFUND_PENDING;

        refundRequired = {
          paymentId: payment.id,

          providerPaymentId:
            payment.providerPaymentId!,

          amount:
            Number(payment.amount),

          reason:
            `Order ${order.orderNumber} cancelled by customer`,
        };

        await tx.payment.update({
          where: {
            id: payment.id,
          },

          data: {
            status:
              PaymentStatus.REFUND_PENDING,

            refundAmount:
              payment.amount,

            refundReason:
              `Order ${order.orderNumber} cancelled by customer`,
          },
        });
      } else if (
        refundAlreadyPending
      ) {
        /*
         * Refund has already been requested.
         *
         * Do not create another refund.
         */

        nextPaymentStatus =
          PaymentStatus.REFUND_PENDING;
      } else if (
        alreadyRefunded
      ) {
        /*
         * Do not change an already completed refund.
         */

        nextPaymentStatus =
          order.paymentStatus;
      }

      /*
       * =====================================================
       * CANCEL ORDER
       * =====================================================
       */

      const updatedOrder =
        await tx.order.update({
          where: {
            id: order.id,
          },

          data: {
            status:
              OrderStatus.CANCELLED,

            paymentStatus:
              nextPaymentStatus,

            stockReserved: false,
          },

          include:
            ORDER_INCLUDE,
        });

      return serializeOrder(
        updatedOrder,
      );
    },

    {
      isolationLevel:
        Prisma.TransactionIsolationLevel.Serializable,

      timeout: 15000,
    },
  );

  /*
   * ==========================================================
   * RAZORPAY REFUND
   * ==========================================================
   *
   * IMPORTANT:
   *
   * This is intentionally OUTSIDE the database transaction.
   *
   * If Razorpay is temporarily unavailable, the order remains
   * cancelled and the payment remains REFUND_PENDING.
   *
   * It is NOT falsely marked REFUNDED.
   */

  if (refundRequired) {
    try {
      const refund =
         await initiateRazorpayRefund(
          refundRequired.paymentId,
          refundRequired.providerPaymentId,
          refundRequired.amount,
          refundRequired.reason,
        );

      return {
        ...result,

        refundRequested: true,

        refundPending: true,

        refundId:
          refund.refundId ?? null,
      };
    } catch (error) {
      console.error(
        "ORDER CANCELLATION REFUND ERROR:",
        error,
      );

      /*
       * The order is already safely cancelled and the DB payment
       * is still REFUND_PENDING.
       *
       * Do NOT change it to REFUNDED.
       *
       * A retry/reconciliation mechanism can process this later.
       */

      return {
        ...result,

        refundRequested: false,

        refundPending: true,

        refundError:
          "Refund request could not be completed yet",
      };
    }
  }

  return result;
}