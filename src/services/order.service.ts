import { Prisma, OrderStatus, PaymentStatus } from "@prisma/client";
import { initiateRazorpayRefund } from "./payment.service";
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

  payments: {
    orderBy: {
      createdAt: "asc" as const,
    },
    select: {
      id: true,
      provider: true,
      providerPaymentId: true,
      amount: true,
      currency: true,
      status: true,
      method: true,
      refundAmount: true,
      refundReason: true,
      refundedAt: true,

      // Add refund ledger records here.
      refunds: {
        select: {
          amount: true,
          status: true,
        },
      },

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

/**
 * Calculates the amount actually retained from successful payments.
 *
 * PAID / PARTIALLY_PAID:
 *   Count the captured payment amount.
 *
 * PARTIALLY_REFUNDED:
 *   Count only the amount remaining after refunds.
 *
 * REFUNDED / PENDING / FAILED / REFUND_PENDING:
 *   Do not count as successfully retained payment.
 */

function calculatePaidAmount(order: OrderWithItems): number {
  const paidInPaise = order.payments.reduce((sum, payment) => {
    const amountInPaise = Math.round(Number(payment.amount) * 100);

    const processedRefundsInPaise = Math.round(
      payment.refunds
        .filter((refund) => refund.status === "PROCESSED")
        .reduce((total, refund) => total + Number(refund.amount), 0) * 100,
    );

    let refundedInPaise = processedRefundsInPaise;

    // Support older payment records created before the refund ledger existed.
    if (
      processedRefundsInPaise === 0 &&
      (payment.status === PaymentStatus.PARTIALLY_REFUNDED ||
        payment.status === PaymentStatus.REFUNDED)
    ) {
      refundedInPaise = Math.round(Number(payment.refundAmount ?? 0) * 100);

      if (payment.status === PaymentStatus.REFUNDED && refundedInPaise === 0) {
        refundedInPaise = amountInPaise;
      }
    }

    switch (payment.status) {
      case PaymentStatus.PAID:
      case PaymentStatus.PARTIALLY_PAID:
      case PaymentStatus.REFUND_PENDING:
      case PaymentStatus.PARTIALLY_REFUNDED:
      case PaymentStatus.REFUNDED:
        return sum + Math.max(0, amountInPaise - refundedInPaise);

      default:
        return sum;
    }
  }, 0);

  return Number((paidInPaise / 100).toFixed(2));
}

function serializeOrder(order: OrderWithItems) {
  const totalAmount = decimalToNumber(order.totalAmount);

  const paidAmount = Math.min(totalAmount, calculatePaidAmount(order));

  const remainingAmount = Number(
    Math.max(0, totalAmount - paidAmount).toFixed(2),
  );

  return {
    id: order.id,
    orderNumber: order.orderNumber,

    userId: order.userId,

    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    shiprocketOrderId: order.shiprocketOrderId,
    shiprocketShipmentId: order.shiprocketShipmentId,
    shiprocketAwbCode: order.shiprocketAwbCode,
    shiprocketCourierName: order.shiprocketCourierName,
    shiprocketTrackingUrl: order.shiprocketTrackingUrl,
    shiprocketStatus: order.shiprocketStatus,
    shiprocketStatusCode: order.shiprocketStatusCode,
    shiprocketLastEventAt: order.shiprocketLastEventAt,
    shiprocketPickupScheduledAt: order.shiprocketPickupScheduledAt,
    shiprocketShippedAt: order.shiprocketShippedAt,
    shiprocketDeliveredAt: order.shiprocketDeliveredAt,
    subtotal: decimalToNumber(order.subtotal),
    deliveryAmount: decimalToNumber(order.deliveryAmount),
    discountAmount: decimalToNumber(order.discountAmount),
    couponCode: order.couponCode,

    totalAmount,
    paidAmount,
    remainingAmount,

    currency: order.currency,

    payments: order.payments.map((payment) => ({
      id: payment.id,
      provider: payment.provider,
      providerPaymentId: payment.providerPaymentId,
      amount: decimalToNumber(payment.amount),
      currency: payment.currency,
      status: payment.status,
      method: payment.method,
      refundAmount:
        payment.refundAmount === null
          ? 0
          : decimalToNumber(payment.refundAmount),
      refundReason: payment.refundReason,
      refundedAt: payment.refundedAt,
      createdAt: payment.createdAt,
    })),

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
        item.imageUrl && !/\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(item.imageUrl)
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

  const random = Math.random().toString(36).substring(2, 8).toUpperCase();

  return `PB-${timestamp}-${random}`;
}

async function createUniqueOrderNumber(tx: TransactionClient): Promise<string> {
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

export async function createOrder(userId: string, input: CreateOrderInput) {
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

        if (item.product.variants.length > 0 && !item.variant) {
          throw new Error("VARIANT_REQUIRED");
        }

        if (item.variant) {
          if (item.variant.productId !== item.productId) {
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

          if (item.quantity > item.variant.stock) {
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

      const orderItems = cart.items.map((item) => {
        const unitPrice = decimalToNumber(
          item.variant?.price ?? item.product.price,
        );

        const originalPrice = decimalToNumber(
          item.variant?.originalPrice ?? item.product.originalPrice,
        );

        const itemSubtotal = Number((unitPrice * item.quantity).toFixed(2));

        subtotal += itemSubtotal;

        const imageUrl =
          item.variant?.images[0]?.url ?? item.product.images[0]?.url ?? null;

        return {
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

      const deliveryAmount = 0;

      // Only accept the coupon explicitly supplied with this order.
      // Prices and totals are calculated from database records above.
      const couponCode = input.couponCode?.trim().toUpperCase() || null;

      if (couponCode && couponCode !== "SUREDISCOUNT") {
        throw new Error("INVALID_COUPON");
      }

      // The discount must not make the order total zero or negative.
      if (couponCode === "SUREDISCOUNT" && subtotal <= 1000) {
        throw new Error("COUPON_MINIMUM_NOT_MET");
      }

      // Flat ₹1,000 per order, applied once.
      const discountAmount = couponCode === "SUREDISCOUNT" ? 1000 : 0;

      const totalAmount = Number(
        (subtotal + deliveryAmount - discountAmount).toFixed(2),
      );

      /*
       * =====================================================
       * 5. Generate order number
       * =====================================================
       */

      const orderNumber = await createUniqueOrderNumber(tx);

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

      const order = await tx.order.create({
        data: {
          orderNumber,

          userId,

          status: OrderStatus.PENDING,

          paymentStatus: PaymentStatus.PENDING,

          paymentMethod: input.paymentMethod,

          stockReserved: false,

          subtotal,

          deliveryAmount,

          discountAmount,

          couponCode,

          totalAmount,

          currency: "INR",

          shippingFullName: address.fullName,

          shippingPhone: address.phone,

          shippingAddressLine1: address.addressLine1,

          shippingAddressLine2: address.addressLine2,

          shippingArea: address.landmark,

          shippingCity: address.city,

          shippingState: address.state,

          shippingPostalCode: address.postalCode,

          shippingCountry: address.country,

          shippingLandmark: address.landmark,

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
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,

      timeout: 15000,
    },
  );
}

export async function getOrderById(userId: string, orderId: string) {
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

export async function getUserOrders(userId: string) {
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

export async function cancelOrder(userId: string, orderId: string) {
  type RefundJob = {
    paymentId: string;
    providerPaymentId: string;
    amount: number;
    reason: string;
  };

  const refundJobs: RefundJob[] = [];

  const result = await prisma.$transaction(
    async (tx) => {
      // Serialize cancellation against payment capture and cash collection.
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "Order"
        WHERE "id" = ${orderId}
        FOR UPDATE
      `;

      const order = await tx.order.findFirst({
        where: {
          id: orderId,
          userId,
        },
        include: {
          items: true,
          payments: {
            orderBy: {
              createdAt: "asc",
            },
            include: {
              refunds: true,
            },
          },
        },
      });

      if (!order) {
        throw new Error("ORDER_NOT_FOUND");
      }

      const cancellableStatuses: OrderStatus[] = [
        OrderStatus.PENDING,
        OrderStatus.CONFIRMED,
      ];

      if (!cancellableStatuses.includes(order.status)) {
        throw new Error("ORDER_CANNOT_BE_CANCELLED");
      }

      const reason = `Order ${order.orderNumber} cancelled by customer`;

      let hasRefundPending = false;
      let hasManualCashRefund = false;
      let hasProcessedRefund = false;
      let hasCapturedPayment = false;

      for (const payment of order.payments) {
        const captured =
          payment.status === PaymentStatus.PAID ||
          payment.status === PaymentStatus.PARTIALLY_PAID ||
          payment.status === PaymentStatus.REFUND_PENDING ||
          payment.status === PaymentStatus.PARTIALLY_REFUNDED ||
          payment.status === PaymentStatus.REFUNDED;

        if (!captured) {
          continue;
        }

        hasCapturedPayment = true;

        const amount = Number(payment.amount);

        const processedRefunds = payment.refunds
          .filter((refund) => refund.status === "PROCESSED")
          .reduce((total, refund) => total + Number(refund.amount), 0);

        const legacyRefund =
          payment.refunds.length === 0 &&
          (payment.status === PaymentStatus.PARTIALLY_REFUNDED ||
            payment.status === PaymentStatus.REFUNDED)
            ? Number(payment.refundAmount ?? 0) ||
              (payment.status === PaymentStatus.REFUNDED ? amount : 0)
            : 0;

        const alreadyRefunded = Math.max(processedRefunds, legacyRefund);

        const pendingRefund =
          payment.status === PaymentStatus.REFUND_PENDING ||
          payment.refunds.some(
            (refund) =>
              refund.status === "REQUESTED" ||
              refund.status === "MANUAL_PENDING",
          );

        if (alreadyRefunded > 0) {
          hasProcessedRefund = true;
        }

        if (pendingRefund) {
          hasRefundPending = true;

          if (payment.provider === "CASH") {
            hasManualCashRefund = true;
          }

          continue;
        }

        const refundableAmount = Number(
          Math.max(0, amount - alreadyRefunded).toFixed(2),
        );

        if (refundableAmount <= 0) {
          continue;
        }

        if (payment.provider === "RAZORPAY") {
          if (!payment.providerPaymentId) {
            throw new Error("RAZORPAY_PAYMENT_ID_NOT_FOUND");
          }

          // Mark it pending inside the transaction. The actual
          // provider request happens only after this transaction commits.
          await tx.payment.update({
            where: {
              id: payment.id,
            },
            data: {
              status: PaymentStatus.REFUND_PENDING,
              refundId: null,
              refundReason: reason,
            },
          });

          refundJobs.push({
            paymentId: payment.id,
            providerPaymentId: payment.providerPaymentId,
            amount: refundableAmount,
            reason,
          });

          hasRefundPending = true;
          continue;
        }

        if (payment.provider === "CASH") {
          // Cash must be returned manually. Never call Razorpay with
          // a synthetic CASH-* payment reference.
          const requestKey = `manual_cash_refund_${order.id}_${payment.id}`;

          await tx.paymentRefund.create({
            data: {
              paymentId: payment.id,
              requestKey,
              amount: refundableAmount,
              reason: `${reason} - manual cash refund`,
              status: "MANUAL_PENDING",
            },
          });

          await tx.payment.update({
            where: {
              id: payment.id,
            },
            data: {
              status: PaymentStatus.REFUND_PENDING,
              refundReason: `${reason} - manual cash refund`,
            },
          });

          hasRefundPending = true;
          hasManualCashRefund = true;
        }
      }

      // Restore stock exactly once.
      if (order.stockReserved) {
        for (const item of order.items) {
          if (item.variantId === null) {
            continue;
          }

          const restored = await tx.productVariant.updateMany({
            where: {
              id: item.variantId,
              productId: item.productId,
            },
            data: {
              stock: {
                increment: item.quantity,
              },
            },
          });

          if (restored.count !== 1) {
            throw new Error("STOCK_RESTORE_FAILED");
          }
        }
      }

      let nextPaymentStatus = order.paymentStatus;

      if (hasRefundPending) {
        nextPaymentStatus = PaymentStatus.REFUND_PENDING;
      } else if (hasCapturedPayment) {
        const refreshedOrder = await tx.order.findUnique({
          where: { id: order.id },
          include: ORDER_INCLUDE,
        });

        if (!refreshedOrder) {
          throw new Error("ORDER_NOT_FOUND");
        }

        const retainedAmount = calculatePaidAmount(
          refreshedOrder as OrderWithItems,
        );

        if (retainedAmount <= 0) {
          nextPaymentStatus = PaymentStatus.REFUNDED;
        } else if (hasProcessedRefund) {
          nextPaymentStatus = PaymentStatus.PARTIALLY_REFUNDED;
        }
      }

      const updatedOrder = await tx.order.update({
        where: {
          id: order.id,
        },
        data: {
          status: OrderStatus.CANCELLED,
          paymentStatus: nextPaymentStatus,
          stockReserved: false,
        },
        include: ORDER_INCLUDE,
      });

      return {
        order: serializeOrder(updatedOrder),
        manualCashRefundPending: hasManualCashRefund,
        refundPending: hasRefundPending,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 20000,
    },
  );

  // Contact Razorpay only after the database transaction has committed.
  const refundResults: Array<{
    paymentId: string;
    success: boolean;
    refundId?: string | null;
  }> = [];

  for (const job of refundJobs) {
    try {
      const refund = await initiateRazorpayRefund(
        job.paymentId,
        job.providerPaymentId,
        job.amount,
        job.reason,
        `order-cancel-${orderId}-${job.paymentId}`,
      );

      refundResults.push({
        paymentId: job.paymentId,
        success: true,
        refundId: refund.refundId ?? null,
      });
    } catch (error) {
      // Keep the payment REFUND_PENDING. Do not automatically
      // issue another refund after an ambiguous provider failure.
      console.error("ORDER CANCELLATION REFUND ERROR:", {
        orderId,
        paymentId: job.paymentId,
        error,
      });

      refundResults.push({
        paymentId: job.paymentId,
        success: false,
      });
    }
  }

  return {
    ...result.order,
    refundPending: result.refundPending,
    manualCashRefundPending: result.manualCashRefundPending,
    refundResults,
  };
}
