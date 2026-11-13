import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
} from "@prisma/client";

import { prisma } from "../config/prisma";
import { env } from "../config/env";

import {
  createShiprocketOrder,
  getShiprocketToken,
  type ShiprocketCreateOrderPayload,
  assignShiprocketAwb,
  scheduleShiprocketPickup,
  generateShiprocketManifest,
} from "./shiprocket.service";

/**
 * Calculate the actual amount collected from the customer.
 *
 * Captured payments are counted, while processed refunds
 * are deducted from the collected amount.
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
  const capturedStatuses = new Set<PaymentStatus>([
    PaymentStatus.PAID,
    PaymentStatus.PARTIALLY_PAID,
    PaymentStatus.REFUND_PENDING,
    PaymentStatus.PARTIALLY_REFUNDED,
    PaymentStatus.REFUNDED,
  ]);

  const collected = payments.reduce((sum, payment) => {
    if (!capturedStatuses.has(payment.status)) {
      return sum;
    }

    const amount = Number(payment.amount);

    const processedRefunds = (payment.refunds ?? [])
      .filter((refund) => refund.status === "PROCESSED")
      .reduce((refundTotal, refund) => refundTotal + Number(refund.amount), 0);

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

  return Number(collected.toFixed(2));
}

/**
 * Validate a required string value.
 */
function requiredValue(value: string | null | undefined, field: string) {
  const result = String(value ?? "").trim();

  if (!result) {
    throw new Error(`SHIPROCKET_MISSING_${field}`);
  }

  return result;
}

/**
 * Normalize and validate an Indian mobile number.
 */
function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");

  const phone = digits.length > 10 ? digits.slice(-10) : digits;

  if (!/^[6-9]\d{9}$/.test(phone)) {
    throw new Error("INVALID_SHIPPING_PHONE");
  }

  return phone;
}

/**
 * Read parcel dimensions from environment configuration.
 */
function getParcelConfiguration() {
  const weight = env.SHIPROCKET_DEFAULT_WEIGHT_KG;
  const length = env.SHIPROCKET_DEFAULT_LENGTH_CM;
  const breadth = env.SHIPROCKET_DEFAULT_BREADTH_CM;
  const height = env.SHIPROCKET_DEFAULT_HEIGHT_CM;

  if (
    !weight ||
    !length ||
    !breadth ||
    !height ||
    weight <= 0 ||
    length <= 0.5 ||
    breadth <= 0.5 ||
    height <= 0.5
  ) {
    throw new Error("SHIPROCKET_PARCEL_DIMENSIONS_NOT_CONFIGURED");
  }

  return {
    weight,
    length,
    breadth,
    height,
  };
}

type ReservedOrder = {
  id: string;
  orderNumber: string;
  createdAt: Date;
  totalAmount: number;
  subtotal: number;

  shippingFullName: string;
  shippingPhone: string;
  shippingAddressLine1: string;
  shippingAddressLine2: string | null;
  shippingArea: string | null;
  shippingLandmark: string | null;
  shippingCity: string;
  shippingState: string;
  shippingPostalCode: string;
  shippingCountry: string;

  customerEmail: string;

  paymentMethod: PaymentMethod;
  paidAmount: number;
  remainingAmount: number;

  items: Array<{
    productId: number;
    productName: string;
    brand: string;
    storage: string | null;
    color: string | null;
    quantity: number;
    unitPrice: number;
  }>;
};

/**
 * Lock and reserve an order before creating its Shiprocket order.
 *
 * All customer and payment validations happen before setting
 * shiprocketStatus to CREATING.
 */
async function reserveOrderForShipment(
  orderId: string,
): Promise<ReservedOrder> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "Order"
        WHERE "id" = ${orderId}
        FOR UPDATE
      `;

      const order = await tx.order.findUnique({
        where: {
          id: orderId,
        },
        include: {
          user: {
            select: {
              email: true,
            },
          },
          items: {
            orderBy: {
              createdAt: "asc",
            },
          },
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

      if (order.shiprocketOrderId || order.shiprocketShipmentId) {
        throw new Error("SHIPROCKET_SHIPMENT_ALREADY_CREATED");
      }

      if (
        order.shiprocketStatus === "CREATING" ||
        order.shiprocketStatus === "CREATION_UNCERTAIN"
      ) {
        throw new Error("SHIPROCKET_CREATION_ALREADY_IN_PROGRESS");
      }

      if (
        order.status !== OrderStatus.CONFIRMED &&
        order.status !== OrderStatus.PROCESSING
      ) {
        throw new Error("ORDER_NOT_READY_FOR_SHIPMENT");
      }

      if (!order.items.length) {
        throw new Error("ORDER_HAS_NO_ITEMS");
      }

      const paidAmount = calculateCollectedAmount(order.payments);

      const totalAmount = Number(order.totalAmount);

      const remainingAmount = Number(
        Math.max(0, totalAmount - paidAmount).toFixed(2),
      );

      if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
        throw new Error("INVALID_ORDER_TOTAL");
      }

      // COD orders can have a partially paid advance.
      // Only the outstanding balance will be collected by Shiprocket.
      if (order.paymentMethod !== PaymentMethod.COD && remainingAmount > 0.01) {
        throw new Error("PREPAID_ORDER_HAS_OUTSTANDING_BALANCE");
      }

      if (
        order.paymentStatus === PaymentStatus.REFUND_PENDING ||
        order.paymentStatus === PaymentStatus.REFUNDED ||
        order.paymentStatus === PaymentStatus.PARTIALLY_REFUNDED
      ) {
        throw new Error("ORDER_HAS_REFUND_ACTIVITY");
      }

      /**
       * Validate customer details before reserving the order.
       * This prevents invalid details from leaving the order
       * stuck in CREATING.
       */
      const validatedFullName = requiredValue(
        order.shippingFullName,
        "CUSTOMER_NAME",
      );

      const validatedPhone = normalizePhone(order.shippingPhone);

      const validatedAddress = requiredValue(
        order.shippingAddressLine1,
        "ADDRESS",
      );

      const validatedEmail = requiredValue(order.user.email, "CUSTOMER_EMAIL");

      const validatedCity = requiredValue(order.shippingCity, "CITY");

      const validatedState = requiredValue(order.shippingState, "STATE");

      const validatedPostalCode = requiredValue(
        order.shippingPostalCode,
        "POSTAL_CODE",
      );

      const validatedCountry = requiredValue(
        order.shippingCountry || "India",
        "COUNTRY",
      );

      // Reserve the order only after all validations succeed.
      await tx.order.update({
        where: {
          id: order.id,
        },
        data: {
          shiprocketStatus: "CREATING",
          shiprocketLastEventAt: new Date(),
        },
      });

      return {
        id: order.id,
        orderNumber: order.orderNumber,
        createdAt: order.createdAt,
        totalAmount,
        subtotal: Number(order.subtotal),

        shippingFullName: validatedFullName,
        shippingPhone: validatedPhone,
        shippingAddressLine1: validatedAddress,
        shippingAddressLine2: order.shippingAddressLine2,
        shippingArea: order.shippingArea,
        shippingLandmark: order.shippingLandmark,
        shippingCity: validatedCity,
        shippingState: validatedState,
        shippingPostalCode: validatedPostalCode,
        shippingCountry: validatedCountry,

        customerEmail: validatedEmail,

        paymentMethod: order.paymentMethod,
        paidAmount,
        remainingAmount,

        items: order.items.map((item) => ({
          productId: item.productId,
          productName: item.productName,
          brand: item.brand,
          storage: item.storage,
          color: item.color,
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice),
        })),
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 15000,
    },
  );
}

/**
 * Create a Shiprocket order from an existing PhoneBhai order.
 *
 * This function does not:
 * - Change the order's payment status.
 * - Create or modify payment records.
 * - Automatically assign an AWB.
 * - Automatically schedule a pickup.
 */
export async function createAdminShiprocketShipment(orderId: string) {
  const pickupLocation = requiredValue(
    env.SHIPROCKET_PICKUP_LOCATION,
    "PICKUP_LOCATION",
  );

  const parcel = getParcelConfiguration();

  // Authenticate before reserving the order.
  await getShiprocketToken();

  // Validate and reserve the order.
  const order = await reserveOrderForShipment(orderId);

  const nameParts = order.shippingFullName.split(/\s+/);

  const firstName = nameParts.shift() ?? order.shippingFullName;

  const lastName = nameParts.join(" ");

  const address = order.shippingAddressLine1;

  const addressParts = [
    order.shippingAddressLine2,
    order.shippingArea,
    order.shippingLandmark,
  ].filter(Boolean);

  const address2 = addressParts.join(", ");

  const phone = order.shippingPhone;
  const email = order.customerEmail;

  const paymentMethod =
    order.paymentMethod === PaymentMethod.COD && order.remainingAmount > 0.01
      ? "COD"
      : "Prepaid";

  const orderItems: ShiprocketCreateOrderPayload["order_items"] =
    order.items.map((item) => ({
      name: [item.brand, item.productName, item.storage, item.color]
        .filter(Boolean)
        .join(" ")
        .slice(0, 100),

      sku: `PB-${item.productId}`,
      units: item.quantity,
      selling_price: item.unitPrice,
    }));

  const payload: ShiprocketCreateOrderPayload = {
    order_id: order.orderNumber.slice(0, 50),

    order_date: order.createdAt.toISOString().slice(0, 16).replace("T", " "),

    pickup_location: pickupLocation,

    billing_customer_name: firstName,
    billing_last_name: lastName,
    billing_address: address,
    billing_address_2: address2,
    billing_city: order.shippingCity,
    billing_pincode: order.shippingPostalCode,
    billing_state: order.shippingState,
    billing_country: order.shippingCountry,
    billing_email: email,
    billing_phone: phone,

    shipping_is_billing: true,

    order_items: orderItems,

    payment_method: paymentMethod,

    sub_total: order.totalAmount,

    length: parcel.length,
    breadth: parcel.breadth,
    height: parcel.height,
    weight: parcel.weight,

    ...(paymentMethod === "COD"
      ? {
          cod_amount: order.remainingAmount,
        }
      : {}),
  };

  try {
    const response = await createShiprocketOrder(payload);

    const shiprocketOrderId = response.order_id;
    const shipmentId = response.shipment_id;

    if (
      !shiprocketOrderId ||
      !shipmentId ||
      Number(shiprocketOrderId) <= 0 ||
      Number(shipmentId) <= 0
    ) {
      throw new Error("SHIPROCKET_RESPONSE_MISSING_IDS");
    }

    const savedOrder = await prisma.order.updateMany({
      where: {
        id: order.id,
        shiprocketStatus: "CREATING",
        shiprocketOrderId: null,
        shiprocketShipmentId: null,
      },
      data: {
        shiprocketOrderId: String(shiprocketOrderId),
        shiprocketShipmentId: String(shipmentId),
        shiprocketStatus: response.status || "ORDER_CREATED",
        shiprocketStatusCode:
          response.status_code == null ? null : String(response.status_code),
        shiprocketLastEventAt: new Date(),
      },
    });

    if (savedOrder.count !== 1) {
      // Shiprocket may already have created the order.
      // Never automatically create another shipment.
      throw new Error("SHIPROCKET_ORDER_CREATED_BUT_LOCAL_SAVE_FAILED");
    }

    return {
      success: true,
      orderId: order.id,
      orderNumber: order.orderNumber,
      shiprocketOrderId: String(shiprocketOrderId),
      shipmentId: String(shipmentId),
      paymentMethod,
      paidAmount: order.paidAmount,
      codAmount: paymentMethod === "COD" ? order.remainingAmount : 0,
      status: response.status || "ORDER_CREATED",
    };
  } catch (error) {
    /**
     * An API timeout can happen even after Shiprocket
     * has successfully created the order.
     *
     * Keep the reservation to prevent duplicate creation.
     */
    await prisma.order.updateMany({
      where: {
        id: order.id,
        shiprocketStatus: "CREATING",
      },
      data: {
        shiprocketStatus: "CREATION_UNCERTAIN",
        shiprocketLastEventAt: new Date(),
      },
    });

    console.error(
      "SHIPROCKET ORDER CREATION ERROR:",
      error instanceof Error ? error.message : "Unknown error",
    );

    throw new Error("SHIPROCKET_CREATION_UNCERTAIN");
  }
}

/**
 * Assign an AWB to an existing Shiprocket shipment.
 * The order is locked before the external request to prevent
 * duplicate AWB assignment from concurrent admin requests.
 */
export async function assignAdminShiprocketAwb(
  orderId: string,
  courierId?: number,
) {
  const order = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "Order"
        WHERE "id" = ${orderId}
        FOR UPDATE
      `;

      const current = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          shiprocketShipmentId: true,
          shiprocketAwbCode: true,
          shiprocketStatus: true,
          shiprocketCourierName: true,
        },
      });

      if (!current) throw new Error("ORDER_NOT_FOUND");

      if (!current.shiprocketShipmentId) {
        throw new Error("SHIPROCKET_SHIPMENT_NOT_CREATED");
      }

      if (current.shiprocketAwbCode) {
        return {
          ...current,
          alreadyAssigned: true,
        };
      }

      if (
        current.shiprocketStatus === "AWB_ASSIGNING" ||
        current.shiprocketStatus === "AWB_ASSIGNMENT_UNCERTAIN"
      ) {
        throw new Error("SHIPROCKET_AWB_ASSIGNMENT_IN_PROGRESS");
      }

      await tx.order.update({
        where: { id: current.id },
        data: { shiprocketStatus: "AWB_ASSIGNING" },
      });

      return {
        ...current,
        alreadyAssigned: false,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 15000,
    },
  );

  if (order.alreadyAssigned) {
    return {
      alreadyAssigned: true,
      awbCode: order.shiprocketAwbCode,
      courierName: order.shiprocketCourierName,
    };
  }

  try {
    const shipmentId = Number(order.shiprocketShipmentId);

    if (!Number.isInteger(shipmentId) || shipmentId <= 0) {
      throw new Error("INVALID_SHIPROCKET_SHIPMENT_ID");
    }

    const response = await assignShiprocketAwb(shipmentId, courierId);

    const awbCode = response.response?.data?.awb_code?.trim();
    const courierName = response.response?.data?.courier_name ?? null;

    if (!awbCode) {
      throw new Error("SHIPROCKET_AWB_ASSIGNMENT_UNCERTAIN");
    }

    await prisma.order.update({
      where: { id: order.id },
      data: {
        shiprocketAwbCode: awbCode,
        shiprocketCourierName: courierName,
        shiprocketStatus: "AWB ASSIGNED",
        shiprocketLastEventAt: new Date(),
      },
    });

    return {
      alreadyAssigned: false,
      awbCode,
      courierName,
      shipmentId: order.shiprocketShipmentId,
    };
  } catch (error) {
    await prisma.order.updateMany({
      where: {
        id: order.id,
        shiprocketStatus: "AWB_ASSIGNING",
      },
      data: {
        shiprocketStatus: "AWB_ASSIGNMENT_UNCERTAIN",
        shiprocketLastEventAt: new Date(),
      },
    });

    console.error(
      "SHIPROCKET AWB ASSIGNMENT ERROR:",
      error instanceof Error ? error.message : "Unknown error",
    );

    throw new Error("SHIPROCKET_AWB_ASSIGNMENT_UNCERTAIN");
  }
}

/**
 * Schedule pickup after AWB assignment.
 */
export async function scheduleAdminShiprocketPickup(orderId: string) {
  const order = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "Order"
        WHERE "id" = ${orderId}
        FOR UPDATE
      `;

      const current = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          shiprocketShipmentId: true,
          shiprocketAwbCode: true,
          shiprocketPickupScheduledAt: true,
          shiprocketStatus: true,
        },
      });

      if (!current) throw new Error("ORDER_NOT_FOUND");

      if (!current.shiprocketShipmentId) {
        throw new Error("SHIPROCKET_SHIPMENT_NOT_CREATED");
      }

      if (!current.shiprocketAwbCode) {
        throw new Error("SHIPROCKET_AWB_REQUIRED");
      }

      if (
        current.shiprocketPickupScheduledAt ||
        current.shiprocketStatus === "PICKUP SCHEDULED" ||
        current.shiprocketStatus === "PICKUP REQUESTED"
      ) {
        return {
          ...current,
          alreadyScheduled: true,
        };
      }

      if (
        current.shiprocketStatus === "PICKUP_REQUESTING" ||
        current.shiprocketStatus === "PICKUP_REQUEST_UNCERTAIN"
      ) {
        throw new Error("SHIPROCKET_PICKUP_IN_PROGRESS");
      }

      await tx.order.update({
        where: { id: current.id },
        data: { shiprocketStatus: "PICKUP_REQUESTING" },
      });

      return {
        ...current,
        alreadyScheduled: false,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 15000,
    },
  );

  if (order.alreadyScheduled) {
    return {
      alreadyScheduled: true,
      pickupScheduledAt: order.shiprocketPickupScheduledAt,
      status: order.shiprocketStatus,
    };
  }

  try {
    const shipmentId = Number(order.shiprocketShipmentId);

    if (!Number.isInteger(shipmentId) || shipmentId <= 0) {
      throw new Error("INVALID_SHIPROCKET_SHIPMENT_ID");
    }

    const response = await scheduleShiprocketPickup(shipmentId);

    if (response.pickup_status === 0) {
      throw new Error("SHIPROCKET_PICKUP_REQUEST_UNCERTAIN");
    }

    const rawDate = response.response?.pickup_scheduled_date;
    const parsedDate = rawDate ? new Date(rawDate) : null;

    const pickupDate =
      parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null;

    await prisma.order.update({
      where: { id: order.id },
      data: {
        shiprocketPickupScheduledAt: pickupDate,
        shiprocketStatus: "PICKUP REQUESTED",
        shiprocketLastEventAt: new Date(),
      },
    });

    return {
      alreadyScheduled: false,
      pickupScheduledAt: pickupDate,
      status: "PICKUP REQUESTED",
      response,
    };
  } catch (error) {
    await prisma.order.updateMany({
      where: {
        id: order.id,
        shiprocketStatus: "PICKUP_REQUESTING",
      },
      data: {
        shiprocketStatus: "PICKUP_REQUEST_UNCERTAIN",
        shiprocketLastEventAt: new Date(),
      },
    });

    console.error(
      "SHIPROCKET PICKUP ERROR:",
      error instanceof Error ? error.message : "Unknown error",
    );

    throw new Error("SHIPROCKET_PICKUP_REQUEST_UNCERTAIN");
  }
}

/**
 * Generate a manifest for a shipment after pickup has been requested.
 */
export async function generateAdminShiprocketManifest(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      shiprocketShipmentId: true,
      shiprocketAwbCode: true,
      shiprocketPickupScheduledAt: true,
      shiprocketStatus: true,
    },
  });

  if (!order) throw new Error("ORDER_NOT_FOUND");

  if (!order.shiprocketShipmentId) {
    throw new Error("SHIPROCKET_SHIPMENT_NOT_CREATED");
  }

  if (!order.shiprocketAwbCode) {
    throw new Error("SHIPROCKET_AWB_REQUIRED");
  }

  if (
    !order.shiprocketPickupScheduledAt &&
    order.shiprocketStatus !== "PICKUP REQUESTED" &&
    order.shiprocketStatus !== "PICKUP SCHEDULED"
  ) {
    throw new Error("SHIPROCKET_MANIFEST_REQUIRES_PICKUP");
  }

  const shipmentId = Number(order.shiprocketShipmentId);

  if (!Number.isInteger(shipmentId) || shipmentId <= 0) {
    throw new Error("INVALID_SHIPROCKET_SHIPMENT_ID");
  }

  try {
    return await generateShiprocketManifest(shipmentId);
  } catch (error) {
    console.error(
      "SHIPROCKET MANIFEST ERROR:",
      error instanceof Error ? error.message : "Unknown error",
    );

    throw new Error("SHIPROCKET_MANIFEST_FAILED");
  }
}
