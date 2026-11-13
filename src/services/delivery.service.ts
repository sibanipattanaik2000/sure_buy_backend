import { OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { shiprocketRequest } from "./shiprocket.service";

type CourierCompany = {
  courier_name?: string;
  estimated_delivery_days?: string | number;
  etd?: string;
  etd_hours?: number | string;
  rate?: number | string;
  freight_charge?: number | string;
};

type ServiceabilityResponse = {
  data?: {
    available_courier_companies?: CourierCompany[];
  };
};

export async function getDeliveryServiceability(deliveryPostcode: string) {
  const pickupPostcode = env.SHIPROCKET_PICKUP_POSTCODE;

  if (!pickupPostcode) {
    throw new Error("SHIPROCKET_PICKUP_POSTCODE_NOT_CONFIGURED");
  }

  const params = new URLSearchParams({
    pickup_postcode: pickupPostcode,
    delivery_postcode: deliveryPostcode,
    cod: "0",
    weight: String(env.SHIPROCKET_DEFAULT_WEIGHT_KG ?? 0.5),
    length: String(env.SHIPROCKET_DEFAULT_LENGTH_CM ?? 20),
    breadth: String(env.SHIPROCKET_DEFAULT_BREADTH_CM ?? 15),
    height: String(env.SHIPROCKET_DEFAULT_HEIGHT_CM ?? 10),
  });

  const response = await shiprocketRequest<ServiceabilityResponse>(
    `/courier/serviceability/?${params.toString()}`,
    { method: "GET" },
  );

  const couriers = response.data?.available_courier_companies ?? [];

  const sortedCouriers = [...couriers].sort((a, b) => {
    const aHours = Number(a.etd_hours ?? Number.MAX_SAFE_INTEGER);
    const bHours = Number(b.etd_hours ?? Number.MAX_SAFE_INTEGER);

    return aHours - bHours;
  });

  const selected = sortedCouriers[0];

  const estimatedDays =
    selected?.estimated_delivery_days == null
      ? null
      : Number(selected.estimated_delivery_days);

  return {
    serviceable: couriers.length > 0,
    courierCount: couriers.length,
    courierName: selected?.courier_name ?? null,
    etd: selected?.etd ?? null,
    estimatedDeliveryDays:
      estimatedDays !== null && Number.isFinite(estimatedDays)
        ? estimatedDays
        : null,
  };
}

function parseShiprocketDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const parsed = new Date(value);

  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  // Shiprocket webhook format: DD MM YYYY HH:mm:ss
  const match = value.match(
    /^(\d{2}) (\d{2}) (\d{4}) (\d{2}):(\d{2}):(\d{2})$/,
  );

  if (!match) {
    return null;
  }

  const [, day, month, year, hour, minute, second] = match;

  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+05:30`);
}

export async function processShiprocketWebhook(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    throw new Error("INVALID_DELIVERY_WEBHOOK_PAYLOAD");
  }

  const body = payload as Record<string, unknown>;

  // Ignore return-leg events here. They need a separate return workflow.
  if (String(body.is_return ?? "0") === "1") {
    return { matched: false, ignored: true };
  }

  const orderReference = String(
    body.channel_order_id ?? body.order_id ?? "",
  ).trim();

  const shiprocketOrderId =
    body.sr_order_id == null ? null : String(body.sr_order_id);

  const shipmentId = body.shipment_id == null ? null : String(body.shipment_id);

  const awb = String(body.awb ?? body.awb_code ?? "").trim() || null;

  const conditions: Prisma.OrderWhereInput[] = [];

  if (orderReference) {
    conditions.push({ orderNumber: orderReference });
  }

  if (shiprocketOrderId) {
    conditions.push({ shiprocketOrderId });
  }

  if (shipmentId) {
    conditions.push({ shiprocketShipmentId: shipmentId });
  }

  if (awb) {
    conditions.push({ shiprocketAwbCode: awb });
  }

  if (conditions.length === 0) {
    return { matched: false, ignored: true };
  }

  const order = await prisma.order.findFirst({
    where: { OR: conditions },
    select: {
      id: true,
      shiprocketLastEventAt: true,
      shiprocketShippedAt: true,
    },
  });

  if (!order) {
    return { matched: false, ignored: true };
  }

  const eventAt = parseShiprocketDate(body.current_timestamp) ?? new Date();

  // Do not let an older webhook overwrite a newer tracking event.
  if (order.shiprocketLastEventAt && eventAt < order.shiprocketLastEventAt) {
    return { matched: true, ignored: true, stale: true };
  }

  const status = String(
    body.current_status ?? body.shipment_status ?? "UNKNOWN",
  ).trim();

  const normalizedStatus = status.toUpperCase().replace(/[_-]+/g, " ");

  const statusCode = body.current_status_id ?? body.shipment_status_id;

  const updateData: Prisma.OrderUpdateInput = {
    shiprocketStatus: status,
    shiprocketStatusCode: statusCode == null ? undefined : String(statusCode),
    shiprocketLastEventAt: eventAt,
  };

  if (shiprocketOrderId) {
    updateData.shiprocketOrderId = shiprocketOrderId;
  }

  if (shipmentId) {
    updateData.shiprocketShipmentId = shipmentId;
  }

  if (awb) {
    updateData.shiprocketAwbCode = awb;
  }

  if (typeof body.courier_name === "string") {
    updateData.shiprocketCourierName = body.courier_name;
  }

  const trackingUrl = body.tracking_url ?? body.track_url;

  if (typeof trackingUrl === "string" && /^https?:\/\//i.test(trackingUrl)) {
    updateData.shiprocketTrackingUrl = trackingUrl;
  }

  const pickupDate = parseShiprocketDate(body.pickup_scheduled_date);

  if (pickupDate) {
    updateData.shiprocketPickupScheduledAt = pickupDate;
  }

  if (normalizedStatus === "DELIVERED") {
    updateData.shiprocketDeliveredAt = eventAt;
    updateData.status = OrderStatus.DELIVERED;
  } else if (normalizedStatus.includes("OUT FOR DELIVERY")) {
    updateData.status = OrderStatus.OUT_FOR_DELIVERY;
  } else if (
    ["SHIPPED", "IN TRANSIT", "PICKED UP", "HANDOVER TO COURIER"].includes(
      normalizedStatus,
    )
  ) {
    updateData.status = OrderStatus.SHIPPED;

    if (!order.shiprocketShippedAt) {
      updateData.shiprocketShippedAt = eventAt;
    }
  }

  await prisma.order.update({
    where: { id: order.id },
    data: updateData,
  });

  // Intentionally do not modify paymentStatus or payment records.
  return {
    matched: true,
    status,
  };
}
