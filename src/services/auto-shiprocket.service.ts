import { OrderStatus, PaymentStatus } from "@prisma/client";

import { prisma } from "../config/prisma";

import {
  createAdminShiprocketShipment,
  assignAdminShiprocketAwb,
  scheduleAdminShiprocketPickup,
} from "./admin-shiprocket.service";

const REFUND_STATUSES = new Set<PaymentStatus>([
  PaymentStatus.REFUND_PENDING,
  PaymentStatus.REFUNDED,
  PaymentStatus.PARTIALLY_REFUNDED,
]);

const UNCERTAIN_STATUSES = new Set([
  "CREATING",
  "CREATION_UNCERTAIN",
  "AWB_ASSIGNING",
  "AWB_ASSIGNMENT_UNCERTAIN",
  "PICKUP_REQUESTING",
  "PICKUP_REQUEST_UNCERTAIN",
]);

export async function processAutomaticShiprocketShipment(orderId: string) {
  let order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      paymentStatus: true,
      shiprocketOrderId: true,
      shiprocketShipmentId: true,
      shiprocketAwbCode: true,
      shiprocketCourierName: true,
      shiprocketPickupScheduledAt: true,
      shiprocketStatus: true,
    },
  });

  if (!order) {
    throw new Error("ORDER_NOT_FOUND");
  }

  if (order.status === OrderStatus.CANCELLED) {
    return {
      success: false,
      skipped: true,
      reason: "ORDER_CANCELLED",
    };
  }

  if (REFUND_STATUSES.has(order.paymentStatus)) {
    return {
      success: false,
      skipped: true,
      reason: "ORDER_HAS_REFUND_ACTIVITY",
    };
  }

  if (
    order.status !== OrderStatus.CONFIRMED &&
    order.status !== OrderStatus.PROCESSING
  ) {
    return {
      success: false,
      skipped: true,
      reason: "ORDER_NOT_READY",
    };
  }

  if (
    order.paymentStatus !== PaymentStatus.PAID &&
    order.paymentStatus !== PaymentStatus.PARTIALLY_PAID
  ) {
    return {
      success: false,
      skipped: true,
      reason: "PAYMENT_NOT_CONFIRMED",
    };
  }

  // STEP 1: CREATE SHIPROCKET ORDER
  if (!order.shiprocketShipmentId) {
    try {
      await createAdminShiprocketShipment(orderId);
    } catch (error) {
      // Another request may have completed the creation
      // while this request was running.
      const latest = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
          shiprocketShipmentId: true,
        },
      });

      if (!latest?.shiprocketShipmentId) {
        throw error;
      }
    }
  }

  // Refresh the order after shipment creation.
  order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      paymentStatus: true,
      shiprocketOrderId: true,
      shiprocketShipmentId: true,
      shiprocketAwbCode: true,
      shiprocketCourierName: true,
      shiprocketPickupScheduledAt: true,
      shiprocketStatus: true,
    },
  });

  if (!order?.shiprocketShipmentId) {
    throw new Error("SHIPROCKET_SHIPMENT_NOT_CREATED");
  }

  // STEP 2: AUTOMATIC AWB ASSIGNMENT
  if (!order.shiprocketAwbCode) {
    await assignAdminShiprocketAwb(orderId);
  }

  // Refresh after AWB assignment.
  const awbOrder = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      shiprocketShipmentId: true,
      shiprocketAwbCode: true,
      shiprocketCourierName: true,
      shiprocketPickupScheduledAt: true,
      shiprocketStatus: true,
    },
  });

  if (!awbOrder?.shiprocketAwbCode) {
    throw new Error("SHIPROCKET_AWB_REQUIRED");
  }

  // STEP 3: AUTOMATIC PICKUP SCHEDULING
  const pickupAlreadyRequested =
    awbOrder.shiprocketStatus === "PICKUP REQUESTED" ||
    awbOrder.shiprocketStatus === "PICKUP SCHEDULED";

  if (!awbOrder.shiprocketPickupScheduledAt && !pickupAlreadyRequested) {
    await scheduleAdminShiprocketPickup(orderId);
  }
  // STEP 4: RETURN FINAL SHIPMENT DETAILS
  const completed = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      shiprocketOrderId: true,
      shiprocketShipmentId: true,
      shiprocketAwbCode: true,
      shiprocketCourierName: true,
      shiprocketTrackingUrl: true,
      shiprocketPickupScheduledAt: true,
      shiprocketStatus: true,
    },
  });

  if (!completed) {
    throw new Error("ORDER_NOT_FOUND");
  }

  return {
    success: true,
    orderId: completed.id,
    shiprocketOrderId: completed.shiprocketOrderId,
    shipmentId: completed.shiprocketShipmentId,
    awbCode: completed.shiprocketAwbCode,
    courierName: completed.shiprocketCourierName,
    trackingUrl: completed.shiprocketTrackingUrl,
    pickupScheduledAt: completed.shiprocketPickupScheduledAt,
    status: completed.shiprocketStatus,
  };
}

export function isShiprocketOperationUncertain(status: string | null) {
  return status !== null && UNCERTAIN_STATUSES.has(status);
}
