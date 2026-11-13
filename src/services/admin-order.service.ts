import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
} from "@prisma/client";

import { prisma } from "../config/prisma";
import { razorpay } from "../config/razorpay";
import { initiateRazorpayRefund } from "./payment.service";

/**
 * Calculate the actual amount retained from successful payments.
 *
 * Processed refunds are deducted from the collected amount.
 * Pending and failed refunds are not deducted.
 */
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

    const capturedStatuses = new Set<PaymentStatus>([
      PaymentStatus.PAID,
      PaymentStatus.PARTIALLY_PAID,
      PaymentStatus.REFUND_PENDING,
      PaymentStatus.PARTIALLY_REFUNDED,
      PaymentStatus.REFUNDED,
    ]);

    if (!capturedStatuses.has(payment.status)) {
      return sum;
    }

    const processedRefunds = (payment.refunds ?? [])
      .filter((refund) => refund.status === "PROCESSED")
      .reduce((value, refund) => value + Number(refund.amount), 0);

    let refunded = processedRefunds;

    // Backward compatibility for payment records that have a
    // refundAmount but no corresponding refund ledger entries.
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
    remainingAmount: Number(Math.max(0, totalAmount - paidAmount).toFixed(2)),
    currency: order.currency,

    // Shiprocket tracking information
    shiprocket: {
      orderId: order.shiprocketOrderId ?? null,
      shipmentId: order.shiprocketShipmentId ?? null,
      awbCode: order.shiprocketAwbCode ?? null,
      courierName: order.shiprocketCourierName ?? null,
      trackingUrl: order.shiprocketTrackingUrl ?? null,
      status: order.shiprocketStatus ?? null,
      statusCode: order.shiprocketStatusCode ?? null,
      lastEventAt: order.shiprocketLastEventAt ?? null,
      pickupScheduledAt: order.shiprocketPickupScheduledAt ?? null,
      shippedAt: order.shiprocketShippedAt ?? null,
      deliveredAt: order.shiprocketDeliveredAt ?? null,
    },

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
      area: order.shippingArea,
      landmark: order.shippingLandmark,
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

      refunds: (payment.refunds ?? []).map((refund: any) => ({
        id: refund.id,
        amount: Number(refund.amount),
        status: refund.status,
        providerRefundId: refund.providerRefundId,
        reason: refund.reason,
        createdAt: refund.createdAt,
        processedAt: refund.processedAt,
      })),
    })),

    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

/**
 * Recalculate the order-level payment status from its payment records
 * and refund ledger.
 */
async function recalculateOrderPaymentStatus(
  tx: Prisma.TransactionClient,
  orderId: string,
) {
  const [order, payments] = await Promise.all([
    tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        totalAmount: true,
      },
    }),

    tx.payment.findMany({
      where: { orderId },
      include: {
        refunds: true,
      },
    }),
  ]);

  if (!order) {
    throw new Error("ORDER_NOT_FOUND");
  }

  const capturedStatuses = new Set<PaymentStatus>([
    PaymentStatus.PAID,
    PaymentStatus.PARTIALLY_PAID,
    PaymentStatus.REFUND_PENDING,
    PaymentStatus.PARTIALLY_REFUNDED,
    PaymentStatus.REFUNDED,
  ]);

  const hasCapturedPayment = payments.some((payment) =>
    capturedStatuses.has(payment.status),
  );

  const hasPendingRefund = payments.some(
    (payment) =>
      payment.status === PaymentStatus.REFUND_PENDING ||
      payment.refunds.some(
        (refund) =>
          refund.status === "REQUESTED" || refund.status === "MANUAL_PENDING",
      ),
  );

  const hasProcessedRefund = payments.some((payment) =>
    payment.refunds.some((refund) => refund.status === "PROCESSED"),
  );

  const collected = calculateCollectedAmount(payments);
  const total = Number(order.totalAmount);

  let nextStatus: PaymentStatus;

  if (hasPendingRefund) {
    nextStatus = PaymentStatus.REFUND_PENDING;
  } else if (hasCapturedPayment && collected <= 0) {
    nextStatus = PaymentStatus.REFUNDED;
  } else if (hasProcessedRefund) {
    nextStatus = PaymentStatus.PARTIALLY_REFUNDED;
  } else if (collected >= total) {
    nextStatus = PaymentStatus.PAID;
  } else if (collected > 0) {
    nextStatus = PaymentStatus.PARTIALLY_PAID;
  } else {
    nextStatus = PaymentStatus.PENDING;
  }

  await tx.order.update({
    where: { id: orderId },
    data: {
      paymentStatus: nextStatus,
    },
  });

  return {
    paymentStatus: nextStatus,
    paidAmount: collected,
    remainingAmount: Number(Math.max(0, total - collected).toFixed(2)),
  };
}

/**
 * Admin confirms that cash from a cancelled COD order
 * has actually been returned to the customer.
 *
 * This endpoint never contacts Razorpay.
 */
export async function confirmManualCashRefund(input: {
  orderId: string;
  refundId: string;
}) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "Order"
        WHERE "id" = ${input.orderId}
        FOR UPDATE
      `;

      const refund = await tx.paymentRefund.findUnique({
        where: { id: input.refundId },
        include: {
          payment: {
            include: {
              refunds: true,
            },
          },
        },
      });

      if (!refund || refund.payment.orderId !== input.orderId) {
        throw new Error("REFUND_NOT_FOUND");
      }

      if (refund.payment.provider !== "CASH") {
        throw new Error("MANUAL_CASH_REFUND_ONLY");
      }

      if (refund.status !== "MANUAL_PENDING") {
        throw new Error("MANUAL_REFUND_NOT_PENDING");
      }

      await tx.paymentRefund.update({
        where: { id: refund.id },
        data: {
          status: "PROCESSED",
          processedAt: new Date(),
        },
      });

      const allRefunds = await tx.paymentRefund.findMany({
        where: {
          paymentId: refund.paymentId,
        },
      });

      const processedAmount = allRefunds
        .filter((item) => item.status === "PROCESSED")
        .reduce((sum, item) => sum + Number(item.amount), 0);

      const pending = allRefunds.some(
        (item) =>
          item.status === "REQUESTED" || item.status === "MANUAL_PENDING",
      );

      const paymentAmount = Number(refund.payment.amount);

      const paymentStatus = pending
        ? PaymentStatus.REFUND_PENDING
        : processedAmount >= paymentAmount
          ? PaymentStatus.REFUNDED
          : processedAmount > 0
            ? PaymentStatus.PARTIALLY_REFUNDED
            : PaymentStatus.PAID;

      await tx.payment.update({
        where: { id: refund.paymentId },
        data: {
          status: paymentStatus,
          refundAmount: Number(processedAmount.toFixed(2)),
          refundedAt:
            paymentStatus === PaymentStatus.REFUNDED ? new Date() : null,
        },
      });

      const orderPayment = await recalculateOrderPaymentStatus(
        tx,
        input.orderId,
      );

      return {
        refundId: refund.id,
        paymentId: refund.paymentId,
        refundAmount: Number(refund.amount),
        paymentStatus: orderPayment.paymentStatus,
        paidAmount: orderPayment.paidAmount,
        remainingAmount: orderPayment.remainingAmount,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 15000,
    },
  );
}

/**
 * Reconcile an existing Razorpay refund request.
 *
 * It only looks up the provider's existing refund.
 * It never creates a new refund.
 */
export async function reconcileRazorpayRefund(input: {
  orderId: string;
  refundId: string;
}) {
  const ledger = await prisma.paymentRefund.findUnique({
    where: { id: input.refundId },
    include: {
      payment: true,
    },
  });

  if (!ledger || ledger.payment.orderId !== input.orderId) {
    throw new Error("REFUND_NOT_FOUND");
  }

  if (ledger.payment.provider !== "RAZORPAY") {
    throw new Error("RAZORPAY_REFUND_ONLY");
  }

  if (!ledger.payment.providerPaymentId) {
    throw new Error("RAZORPAY_PAYMENT_ID_NOT_FOUND");
  }

  if (ledger.status === "PROCESSED") {
    return {
      status: "PROCESSED",
      alreadyProcessed: true,
      providerRefundId: ledger.providerRefundId,
    };
  }

  let providerRefund: any = null;

  try {
    if (ledger.providerRefundId) {
      providerRefund = await razorpay.refunds.fetch(ledger.providerRefundId);
    } else {
      // The installed Razorpay SDK typings do not include payment_id
      // in RazorpayPaginationOptions. The API supports passing this
      // filter, so retain it while working around the SDK type definition.
      const response = (await razorpay.refunds.all({
        payment_id: ledger.payment.providerPaymentId,
        count: 100,
      } as any)) as {
        items?: Array<{
          id: string;
          amount: number;
          payment_id: string;
          status: string;
          notes?: Record<string, unknown>;
        }>;
      };

      providerRefund =
        response.items?.find(
          (item) =>
            item.payment_id === ledger.payment.providerPaymentId &&
            item.notes?.refundRequestKey === ledger.requestKey,
        ) ?? null;
    }
  } catch (error) {
    console.error("RAZORPAY REFUND RECONCILIATION ERROR:", error);
    throw new Error("REFUND_RECONCILIATION_FAILED");
  }

  // No matching refund was found. Do not create another one automatically.
  if (!providerRefund) {
    return {
      status: "UNRESOLVED",
      alreadyProcessed: false,
      providerRefundId: null,
      message:
        "No matching refund was found. Check the Razorpay dashboard before taking further action.",
    };
  }

  if (
    providerRefund.payment_id !== ledger.payment.providerPaymentId ||
    Number(providerRefund.amount) !== Math.round(Number(ledger.amount) * 100)
  ) {
    throw new Error("REFUND_PROVIDER_DETAILS_MISMATCH");
  }

  const providerStatus = String(providerRefund.status).toLowerCase();

  const nextLedgerStatus =
    providerStatus === "processed"
      ? "PROCESSED"
      : providerStatus === "failed"
        ? "FAILED"
        : "REQUESTED";

  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "Order"
        WHERE "id" = ${input.orderId}
        FOR UPDATE
      `;

      await tx.paymentRefund.update({
        where: { id: ledger.id },
        data: {
          providerRefundId: String(providerRefund.id),
          status: nextLedgerStatus,
          processedAt: nextLedgerStatus === "PROCESSED" ? new Date() : null,
        },
      });

      const allRefunds = await tx.paymentRefund.findMany({
        where: {
          paymentId: ledger.paymentId,
        },
      });

      const processedAmount = allRefunds
        .filter((item) => item.status === "PROCESSED")
        .reduce((sum, item) => sum + Number(item.amount), 0);

      const hasPending = allRefunds.some(
        (item) =>
          item.status === "REQUESTED" || item.status === "MANUAL_PENDING",
      );

      const paymentAmount = Number(ledger.payment.amount);

      const paymentStatus = hasPending
        ? PaymentStatus.REFUND_PENDING
        : processedAmount >= paymentAmount
          ? PaymentStatus.REFUNDED
          : processedAmount > 0
            ? PaymentStatus.PARTIALLY_REFUNDED
            : PaymentStatus.PAID;

      await tx.payment.update({
        where: { id: ledger.paymentId },
        data: {
          status: paymentStatus,
          refundId:
            hasPending || nextLedgerStatus === "PROCESSED"
              ? String(providerRefund.id)
              : null,
          refundAmount: Number(processedAmount.toFixed(2)),
          refundedAt:
            paymentStatus === PaymentStatus.REFUNDED ? new Date() : null,
        },
      });

      const orderPayment = await recalculateOrderPaymentStatus(
        tx,
        input.orderId,
      );

      return {
        status: nextLedgerStatus,
        providerStatus,
        providerRefundId: String(providerRefund.id),
        paymentStatus: orderPayment.paymentStatus,
        paidAmount: orderPayment.paidAmount,
        remainingAmount: orderPayment.remainingAmount,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 15000,
    },
  );
}

/**
 * Retry is permitted only after Razorpay has confirmed that
 * the previous refund failed. It uses a new idempotency key.
 */
export async function retryFailedRazorpayRefund(input: {
  orderId: string;
  refundId: string;
  idempotencyKey: string;
}) {
  if (
    !input.idempotencyKey ||
    input.idempotencyKey.length < 12 ||
    input.idempotencyKey.length > 100
  ) {
    throw new Error("INVALID_IDEMPOTENCY_KEY");
  }

  const refund = await prisma.paymentRefund.findUnique({
    where: { id: input.refundId },
    include: {
      payment: {
        include: {
          refunds: true,
        },
      },
    },
  });

  if (!refund || refund.payment.orderId !== input.orderId) {
    throw new Error("REFUND_NOT_FOUND");
  }

  if (
    refund.payment.provider !== "RAZORPAY" ||
    !refund.payment.providerPaymentId
  ) {
    throw new Error("RAZORPAY_REFUND_ONLY");
  }

  if (refund.status !== "FAILED") {
    throw new Error("REFUND_MUST_BE_CONFIRMED_FAILED");
  }

  const anotherPendingRefund = refund.payment.refunds.some(
    (item) =>
      item.id !== refund.id &&
      (item.status === "REQUESTED" || item.status === "MANUAL_PENDING"),
  );

  if (anotherPendingRefund) {
    throw new Error("ANOTHER_REFUND_IS_PENDING");
  }

  // Restore the payment to its refundable state before making
  // a new request. The failed ledger row remains as an audit record.
  await prisma.payment.update({
    where: { id: refund.paymentId },
    data: {
      status: refund.payment.refunds.some((item) => item.status === "PROCESSED")
        ? PaymentStatus.PARTIALLY_REFUNDED
        : PaymentStatus.PAID,
      refundId: null,
    },
  });

  const result = await initiateRazorpayRefund(
    refund.paymentId,
    refund.payment.providerPaymentId,
    Number(refund.amount),
    refund.reason ?? "Admin-approved refund retry",
    `admin-retry-${refund.id}-${input.idempotencyKey}`,
  );

  return {
    success: true,
    refundId: result.refundId ?? null,
    alreadyPending: result.alreadyPending,
    alreadyRefunded: result.alreadyRefunded,
  };
}

/**
 * Admin order query configuration.
 */
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

/**
 * Get paginated admin orders.
 */
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

/**
 * Record cash collected by an admin for a COD order.
 *
 * Uses an order-level database lock to prevent concurrent admins
 * from collecting more than the outstanding balance.
 */
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

  if (
    !input.idempotencyKey ||
    input.idempotencyKey.length < 12 ||
    input.idempotencyKey.length > 100
  ) {
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
          payments: {
            include: {
              refunds: true,
            },
          },
        },
      });

      if (!order) {
        throw new Error("ORDER_NOT_FOUND");
      }

      if (order.paymentMethod !== PaymentMethod.COD) {
        throw new Error("CASH_COLLECTION_COD_ONLY");
      }

      const hasPendingRefund = order.payments.some(
        (payment) =>
          payment.status === PaymentStatus.REFUND_PENDING ||
          payment.refunds.some(
            (refund) =>
              refund.status === "REQUESTED" ||
              refund.status === "MANUAL_PENDING",
          ),
      );

      if (
        order.status === OrderStatus.CANCELLED ||
        order.paymentStatus === PaymentStatus.REFUND_PENDING ||
        order.paymentStatus === PaymentStatus.REFUNDED ||
        hasPendingRefund
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
          include: {
            refunds: true,
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
          remainingAmount: Number(Math.max(0, total - collected).toFixed(2)),
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
        include: {
          refunds: true,
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
