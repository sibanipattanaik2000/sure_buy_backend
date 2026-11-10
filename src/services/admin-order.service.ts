import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
} from "@prisma/client";

import { prisma } from "../config/prisma";

function calculateCollectedAmount(
  payments: Array<{
    amount: Prisma.Decimal | number;
    status: PaymentStatus;
    refundAmount?: Prisma.Decimal | number | null;
    refunds?: Array<{
      amount: Prisma.Decimal | number;
      status: string;
    }>;
  }>,
) {
  const total = payments.reduce((sum, payment) => {
    const amount = Number(payment.amount);

    if (
      payment.status !== PaymentStatus.PAID &&
      payment.status !== PaymentStatus.PARTIALLY_PAID &&
      payment.status !== PaymentStatus.REFUND_PENDING &&
      payment.status !== PaymentStatus.PARTIALLY_REFUNDED &&
      payment.status !== PaymentStatus.REFUNDED
    ) {
      return sum;
    }

    const processedRefunds = (payment.refunds ?? [])
      .filter((refund) => refund.status === "PROCESSED")
      .reduce((value, refund) => value + Number(refund.amount), 0);

    let refunded = processedRefunds;

    if (
      processedRefunds === 0 &&
      (payment.status === PaymentStatus.PARTIALLY_REFUNDED ||
        payment.status === PaymentStatus.REFUNDED)
    ) {
      refunded = Number(payment.refundAmount ?? 0);

      if (payment.status === PaymentStatus.REFUNDED && refunded === 0) {
        refunded = amount;
      }
    }

    return sum + Math.max(0, amount - refunded);
  }, 0);

  return Number(total.toFixed(2));
}
function serializeAdminOrder(order: any) {
  const paidAmount = calculateCollectedAmount(order.payments ?? []);
  const totalAmount = Number(order.totalAmount);

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,

    subtotal: Number(order.subtotal),
    deliveryAmount: Number(order.deliveryAmount),
    discountAmount: Number(order.discountAmount),
    totalAmount,

    paidAmount,
    remainingAmount: Number(
      Math.max(0, totalAmount - paidAmount).toFixed(2),
    ),

    currency: order.currency,

    customer: {
      id: order.user?.id ?? order.userId,
      firstName: order.user?.firstName ?? "",
      lastName: order.user?.lastName ?? "",
      email: order.user?.email ?? "",
      phone: order.shippingPhone,
    },

    shippingAddress: {
      fullName: order.shippingFullName,
      phone: order.shippingPhone,
      addressLine1: order.shippingAddressLine1,
      addressLine2: order.shippingAddressLine2,
      city: order.shippingCity,
      state: order.shippingState,
      postalCode: order.shippingPostalCode,
      country: order.shippingCountry,
    },

    items: (order.items ?? []).map((item: any) => ({
      id: item.id,
      productName: item.productName,
      brand: item.brand,
      storage: item.storage,
      color: item.color,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      subtotal: Number(item.subtotal),
      imageUrl: item.imageUrl,
    })),

    payments: (order.payments ?? []).map((payment: any) => ({
      id: payment.id,
      provider: payment.provider,
      amount: Number(payment.amount),
      currency: payment.currency,
      status: payment.status,
      method: payment.method,
      providerPaymentId: payment.providerPaymentId,
      referenceNote: payment.referenceNote,
      recordedByUserId: payment.recordedByUserId,
      createdAt: payment.createdAt,
    })),

    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

const ADMIN_ORDER_INCLUDE = {
  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
    },
  },
  items: {
    orderBy: {
      createdAt: "asc" as const,
    },
  },
 payments: {
  orderBy: {
    createdAt: "asc" as const,
  },
  include: {
    refunds: {
      orderBy: {
        createdAt: "asc" as const,
      },
    },
  },
  },
} satisfies Prisma.OrderInclude;

export async function getAdminOrders(input: {
  page: number;
  limit: number;
  search: string;
}) {
  const page = Math.max(1, Math.floor(input.page || 1));
  const limit = Math.min(50, Math.max(1, Math.floor(input.limit || 20)));
  const search = input.search.trim();

  const where: Prisma.OrderWhereInput = search
    ? {
        OR: [
          {
            orderNumber: {
              contains: search,
              mode: "insensitive",
            },
          },
          {
            shippingFullName: {
              contains: search,
              mode: "insensitive",
            },
          },
          {
            shippingPhone: {
              contains: search,
            },
          },
          {
            shippingCity: {
              contains: search,
              mode: "insensitive",
            },
          },
          {
            user: {
              email: {
                contains: search,
                mode: "insensitive",
              },
            },
          },
        ],
      }
    : {};

  const [orders, total] = await prisma.$transaction([
    prisma.order.findMany({
      where,
      include: ADMIN_ORDER_INCLUDE,
      orderBy: {
        createdAt: "desc",
      },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.order.count({ where }),
  ]);

  return {
    orders: orders.map(serializeAdminOrder),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

export async function recordCashCollection(input: {
  orderId: string;
  adminUserId: string;
  amount: number;
  referenceNote?: string;
  idempotencyKey: string;
}) {
  const amount = Number(input.amount);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("INVALID_COLLECTION_AMOUNT");
  }

  const normalizedAmount = Number(amount.toFixed(2));

  if (!input.idempotencyKey || input.idempotencyKey.length < 12) {
    throw new Error("INVALID_IDEMPOTENCY_KEY");
  }

  const cashReference = `CASH-${input.idempotencyKey}`;

  return prisma.$transaction(
    async (tx) => {
      // Serialize collections against the same order.
      // This prevents two admins from collecting the same balance.
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "Order"
        WHERE "id" = ${input.orderId}
        FOR UPDATE
      `;

      const order = await tx.order.findUnique({
        where: {
          id: input.orderId,
        },
        include: {
          payments: true,
        },
      });

      if (!order) {
        throw new Error("ORDER_NOT_FOUND");
      }

      if (order.paymentMethod !== PaymentMethod.COD) {
        throw new Error("CASH_COLLECTION_COD_ONLY");
      }

      if (
        order.status === OrderStatus.CANCELLED ||
        order.paymentStatus === PaymentStatus.REFUND_PENDING ||
        order.paymentStatus === PaymentStatus.REFUNDED
      ) {
        throw new Error("ORDER_NOT_COLLECTABLE");
      }

      // Idempotency: retrying the same request cannot create
      // another cash transaction.
      const existingCollection = await tx.payment.findUnique({
        where: {
          providerPaymentId: cashReference,
        },
      });

      if (existingCollection) {
        if (existingCollection.orderId !== order.id) {
          throw new Error("COLLECTION_REFERENCE_CONFLICT");
        }

        const currentPayments = await tx.payment.findMany({
          where: {
            orderId: order.id,
          },
        });

        const collected = calculateCollectedAmount(currentPayments);
        const total = Number(order.totalAmount);

        return {
          alreadyRecorded: true,
          paymentId: existingCollection.id,
          orderId: order.id,
          orderNumber: order.orderNumber,
          paidAmount: collected,
          remainingAmount: Number(
            Math.max(0, total - collected).toFixed(2),
          ),
          paymentStatus:
            collected >= total
              ? PaymentStatus.PAID
              : PaymentStatus.PARTIALLY_PAID,
        };
      }

      const currentCollected = calculateCollectedAmount(order.payments);
      const totalAmount = Number(order.totalAmount);

      const remainingAmount = Number(
        Math.max(0, totalAmount - currentCollected).toFixed(2),
      );

      if (remainingAmount <= 0) {
        throw new Error("ORDER_ALREADY_PAID");
      }

      if (normalizedAmount > remainingAmount) {
        throw new Error("COLLECTION_EXCEEDS_BALANCE");
      }

      await tx.payment.create({
        data: {
          orderId: order.id,
          provider: "CASH",
          providerPaymentId: cashReference,
          amount: normalizedAmount,
          currency: order.currency,
          status: PaymentStatus.PAID,
          method: PaymentMethod.COD,
          recordedByUserId: input.adminUserId,
          referenceNote: input.referenceNote?.trim() || null,
        },
      });

      const allPayments = await tx.payment.findMany({
        where: {
          orderId: order.id,
        },
      });

      const paidAmount = calculateCollectedAmount(allPayments);

      const nextPaymentStatus =
        paidAmount >= totalAmount
          ? PaymentStatus.PAID
          : PaymentStatus.PARTIALLY_PAID;

      await tx.order.update({
        where: {
          id: order.id,
        },
        data: {
          paymentStatus: nextPaymentStatus,
        },
      });

      return {
        alreadyRecorded: false,
        orderId: order.id,
        orderNumber: order.orderNumber,
        paidAmount,
        remainingAmount: Number(
          Math.max(0, totalAmount - paidAmount).toFixed(2),
        ),
        paymentStatus: nextPaymentStatus,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 15000,
    },
  );
}