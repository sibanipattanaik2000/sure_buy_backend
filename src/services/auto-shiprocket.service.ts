
import { OrderStatus, PaymentStatus } from "@prisma/client";

import { prisma } from "../config/prisma";

import {
  createAdminShiprocketShipment,
  assignAdminShiprocketAwb,
  scheduleAdminShiprocketPickup,
  generateAdminShiprocketManifest,
} from "./admin-shiprocket.service";

import { generateShiprocketLabel } from "./shiprocket.service";

const shiprocketOrderSelect = {
  id: true,
  status: true,
  paymentStatus: true,
  shiprocketOrderId: true,
  shiprocketShipmentId: true,
  shiprocketAwbCode: true,
  shiprocketCourierName: true,
  shiprocketTrackingUrl: true,
  shiprocketPickupScheduledAt: true,
  shiprocketStatus: true,
  shiprocketLabelUrl: true,
  shiprocketManifestUrl: true,
  payments: {
    select: {
      status: true,
      refunds: {
        select: {
          status: true,
        },
      },
    },
  },
} as const;

const REFUND_STATUSES = new Set<PaymentStatus>([
  PaymentStatus.REFUND_PENDING,
  PaymentStatus.REFUNDED,
  PaymentStatus.PARTIALLY_REFUNDED,
]);

// These refund states are terminal and do not represent an
// unresolved refund operation.
const TERMINAL_REFUND_STATUSES = new Set([
  "PROCESSED",
  "FAILED",
  "CANCELLED",
]);

const UNCERTAIN_STATUSES = new Set([
  "CREATING",
  "CREATION_UNCERTAIN",
  "AWB_ASSIGNING",
  "AWB_ASSIGNMENT_UNCERTAIN",
  "PICKUP_REQUESTING",
  "PICKUP_REQUEST_UNCERTAIN",
  "LABEL_GENERATING",
  "LABEL_GENERATION_UNCERTAIN",
  "MANIFEST_GENERATING",
  "MANIFEST_GENERATION_UNCERTAIN",
]);

function hasRefundActivity(order: {
  paymentStatus: PaymentStatus;
  payments: Array<{
    status: PaymentStatus;
    refunds: Array<{ status: string }>;
  }>;
}): boolean {
  return (
    REFUND_STATUSES.has(order.paymentStatus) ||
    order.payments.some(
      (payment) =>
        REFUND_STATUSES.has(payment.status) ||
        payment.refunds.some(
          (refund) =>
            !TERMINAL_REFUND_STATUSES.has(refund.status),
        ),
    )
  );
}

export async function processAutomaticShiprocketShipment(
  orderId: string,
) {
  let order = await prisma.order.findUnique({
    where: { id: orderId },
    select: shiprocketOrderSelect,
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

  // Never dispatch an order while any payment has an unresolved
  // refund or a refund-pending/refunded payment status.
  if (
    REFUND_STATUSES.has(order.paymentStatus) ||
    hasRefundActivity(order)
  ) {
    return {
      success: false,
      skipped: true,
      reason: "ORDER_HAS_REFUND_ACTIVITY",
    };
  }

  // An uncertain external operation must be reconciled manually.
  // Never blindly repeat a request that Shiprocket may have accepted.
  if (
    order.shiprocketStatus &&
    UNCERTAIN_STATUSES.has(order.shiprocketStatus)
  ) {
    throw new Error(
      `SHIPROCKET_OPERATION_REQUIRES_MANUAL_REVIEW:${order.shiprocketStatus}`,
    );
  }

  // These conditions are retryable, not permanent skips.
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

  // STEP 1: CREATE SHIPROCKET ORDER.
  if (!order.shiprocketShipmentId) {
    try {
      await createAdminShiprocketShipment(orderId);
    } catch (error) {
      const latest = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
          shiprocketShipmentId: true,
          shiprocketStatus: true,
        },
      });

      // Do not create another shipment if the first request
      // may already have succeeded.
      if (
        !latest?.shiprocketShipmentId ||
        (latest.shiprocketStatus &&
          UNCERTAIN_STATUSES.has(latest.shiprocketStatus))
      ) {
        throw error;
      }
    }
  }

  order = await prisma.order.findUnique({
    where: { id: orderId },
    select: shiprocketOrderSelect,
  });

  if (!order?.shiprocketShipmentId) {
    throw new Error("SHIPROCKET_SHIPMENT_NOT_CREATED");
  }

  if (
    order.shiprocketStatus &&
    UNCERTAIN_STATUSES.has(order.shiprocketStatus)
  ) {
    throw new Error(
      `SHIPROCKET_OPERATION_REQUIRES_MANUAL_REVIEW:${order.shiprocketStatus}`,
    );
  }

  const shipmentId = Number(order.shiprocketShipmentId);

  if (!Number.isInteger(shipmentId) || shipmentId <= 0) {
    throw new Error("INVALID_SHIPROCKET_SHIPMENT_ID");
  }

  // STEP 2: ASSIGN AWB.
  if (!order.shiprocketAwbCode) {
    await assignAdminShiprocketAwb(orderId);
  }

  let latest = await prisma.order.findUnique({
    where: { id: orderId },
    select: shiprocketOrderSelect,
  });

  if (!latest) {
    throw new Error("ORDER_NOT_FOUND");
  }

  if (!latest.shiprocketAwbCode) {
    throw new Error("SHIPROCKET_AWB_REQUIRED");
  }

  if (
    latest.shiprocketStatus &&
    UNCERTAIN_STATUSES.has(latest.shiprocketStatus)
  ) {
    throw new Error(
      `SHIPROCKET_OPERATION_REQUIRES_MANUAL_REVIEW:${latest.shiprocketStatus}`,
    );
  }

  // STEP 3: GENERATE SHIPPING LABEL.
  if (!latest.shiprocketLabelUrl) {
    const label = await generateShiprocketLabel(shipmentId);
    const labelUrl = label.label_url?.trim();

    if (!labelUrl || !/^https?:\/\//i.test(labelUrl)) {
      throw new Error("SHIPROCKET_LABEL_GENERATION_FAILED");
    }

    await prisma.order.update({
      where: { id: orderId },
      data: {
        shiprocketLabelUrl: labelUrl,
      },
    });
  }

  // STEP 4: REQUEST PICKUP.
  latest = await prisma.order.findUnique({
    where: { id: orderId },
    select: shiprocketOrderSelect,
  });

  if (!latest) {
    throw new Error("ORDER_NOT_FOUND");
  }

  if (!latest.shiprocketAwbCode) {
    throw new Error("SHIPROCKET_AWB_REQUIRED");
  }

  if (
    latest.shiprocketStatus &&
    UNCERTAIN_STATUSES.has(latest.shiprocketStatus)
  ) {
    throw new Error(
      `SHIPROCKET_OPERATION_REQUIRES_MANUAL_REVIEW:${latest.shiprocketStatus}`,
    );
  }

  const pickupAlreadyRequested =
    latest.shiprocketStatus === "PICKUP REQUESTED" ||
    latest.shiprocketStatus === "PICKUP SCHEDULED";

  if (
    !latest.shiprocketPickupScheduledAt &&
    !pickupAlreadyRequested
  ) {
    await scheduleAdminShiprocketPickup(orderId);
  }

  // STEP 5: GENERATE MANIFEST AFTER PICKUP.
  latest = await prisma.order.findUnique({
    where: { id: orderId },
    select: shiprocketOrderSelect,
  });

  if (!latest) {
    throw new Error("ORDER_NOT_FOUND");
  }

  const pickupConfirmed =
    Boolean(latest.shiprocketPickupScheduledAt) ||
    latest.shiprocketStatus === "PICKUP REQUESTED" ||
    latest.shiprocketStatus === "PICKUP SCHEDULED";

  if (!pickupConfirmed) {
    throw new Error("SHIPROCKET_PICKUP_NOT_CONFIRMED");
  }

  if (
    latest.shiprocketStatus &&
    UNCERTAIN_STATUSES.has(latest.shiprocketStatus)
  ) {
    throw new Error(
      `SHIPROCKET_OPERATION_REQUIRES_MANUAL_REVIEW:${latest.shiprocketStatus}`,
    );
  }

  if (!latest.shiprocketManifestUrl) {
    const manifest = await generateAdminShiprocketManifest(orderId);

    const manifestUrl = manifest.manifest_url?.trim();

    if (
      !manifestUrl ||
      !/^https?:\/\//i.test(manifestUrl) ||
      String(manifest.status) !== "1"
    ) {
      throw new Error("SHIPROCKET_MANIFEST_GENERATION_FAILED");
    }

    await prisma.order.update({
      where: { id: orderId },
      data: {
        shiprocketManifestUrl: manifestUrl,
      },
    });
  }

  // STEP 6: VERIFY FINAL LOCAL RECORD.
  const completed = await prisma.order.findUnique({
    where: { id: orderId },
    select: shiprocketOrderSelect,
  });

  if (
    !completed ||
    !completed.shiprocketShipmentId ||
    !completed.shiprocketAwbCode ||
    !completed.shiprocketLabelUrl ||
    !completed.shiprocketManifestUrl
  ) {
    throw new Error("SHIPROCKET_DISPATCH_DETAILS_INCOMPLETE");
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
    labelUrl: completed.shiprocketLabelUrl,
    manifestUrl: completed.shiprocketManifestUrl,
    status: completed.shiprocketStatus,
  };
}

export function isShiprocketOperationUncertain(
  status: string | null,
) {
  return status !== null && UNCERTAIN_STATUSES.has(status);
}
