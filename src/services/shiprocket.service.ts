
import { env } from "../config/env";

const SHIPROCKET_BASE_URL =
  "https://apiv2.shiprocket.in/v1/external";

const TOKEN_CACHE_MS = 9 * 24 * 60 * 60 * 1000;

type ShiprocketLoginResponse = {
  token?: string;
  message?: string;
};

let cachedToken: string | null = null;
let tokenExpiresAt = 0;
let loginPromise: Promise<string> | null = null;

export class ShiprocketApiError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ShiprocketApiError";
    this.status = status;
    this.details = details;
  }
}

function getCredentials() {
  const email = env.SHIPROCKET_EMAIL;
  const password = env.SHIPROCKET_PASSWORD;

  if (!email || !password) {
    throw new Error("SHIPROCKET_CREDENTIALS_NOT_CONFIGURED");
  }

  return { email, password };
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function login(): Promise<string> {
  const credentials = getCredentials();

  const response = await fetch(
    `${SHIPROCKET_BASE_URL}/auth/login`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(credentials),
      signal: AbortSignal.timeout(15000),
    },
  );

  const data = (await parseResponse(response)) as
    | ShiprocketLoginResponse
    | null;

  if (!response.ok || !data?.token) {
    throw new ShiprocketApiError(
      "Shiprocket authentication failed",
      response.status,
      data,
    );
  }

  cachedToken = data.token;
  tokenExpiresAt = Date.now() + TOKEN_CACHE_MS;

  return cachedToken;
}

export async function getShiprocketToken(
  forceRefresh = false,
): Promise<string> {
  if (
    !forceRefresh &&
    cachedToken &&
    Date.now() < tokenExpiresAt
  ) {
    return cachedToken;
  }

  if (loginPromise) {
    return loginPromise;
  }

  loginPromise = login();

  try {
    return await loginPromise;
  } finally {
    loginPromise = null;
  }
}

export async function shiprocketRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  if (!path.startsWith("/")) {
    throw new Error("SHIPROCKET_INVALID_API_PATH");
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getShiprocketToken(attempt === 1);

    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("Accept", "application/json");

    if (options.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(
      `${SHIPROCKET_BASE_URL}${path}`,
      {
        ...options,
        headers,
        signal: options.signal ?? AbortSignal.timeout(20000),
      },
    );

    const data = await parseResponse(response);

    if (response.status === 401 && attempt === 0) {
      cachedToken = null;
      tokenExpiresAt = 0;
      continue;
    }

    if (!response.ok) {
      throw new ShiprocketApiError(
        "Shiprocket API request failed",
        response.status,
        data,
      );
    }

    return data as T;
  }

  throw new Error("SHIPROCKET_AUTHENTICATION_RETRY_FAILED");
}
/**
 * ============================================================
 * SHIPROCKET ORDER / SHIPMENT OPERATIONS
 * ============================================================
 */

export type ShiprocketCreateOrderPayload = {
  order_id: string;
  order_date: string;
  pickup_location: string;

  billing_customer_name: string;
  billing_last_name: string;
  billing_address: string;
  billing_address_2?: string;
  billing_city: string;
  billing_pincode: string;
  billing_state: string;
  billing_country: string;
  billing_email: string;
  billing_phone: string;

  shipping_is_billing: boolean;

  shipping_customer_name?: string;
  shipping_last_name?: string;
  shipping_address?: string;
  shipping_address_2?: string;
  shipping_city?: string;
  shipping_pincode?: string;
  shipping_state?: string;
  shipping_country?: string;
  shipping_email?: string;
  shipping_phone?: string;

  order_items: Array<{
    name: string;
    sku: string;
    units: number;
    selling_price: number;
  }>;

  payment_method: "Prepaid" | "COD";
  sub_total: number;
  length: number;
  breadth: number;
  height: number;
  weight: number;
  cod_amount?: number;
};

export type ShiprocketCreateOrderResponse = {
  order_id?: number;
  shipment_id?: number;
  status?: string;
  status_code?: number;
  message?: string;
  [key: string]: unknown;
};

export type ShiprocketAwbResponse = {
  awb_assign_status?: number;
  response?: {
    data?: {
      awb_code?: string;
      courier_name?: string;
      courier_company_id?: number;
      pickup_scheduled_date?: string;
      routing_code?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  message?: string;
  [key: string]: unknown;
};

export type ShiprocketPickupResponse = {
  pickup_status?: number;
  response?: {
    pickup_scheduled_date?: string;
    pickup_token_number?: string;
    [key: string]: unknown;
  };
  message?: string;
  [key: string]: unknown;
};

export type ShiprocketManifestResponse = {
  status?: number;
  manifest_url?: string;
  message?: string;
  [key: string]: unknown;
};

/**
 * Create a custom order in Shiprocket.
 *
 * IMPORTANT:
 * This only creates the order in Shiprocket.
 * It does not assign an AWB or schedule a pickup.
 */
export async function createShiprocketOrder(
  payload: ShiprocketCreateOrderPayload,
): Promise<ShiprocketCreateOrderResponse> {
  return shiprocketRequest<ShiprocketCreateOrderResponse>(
    "/orders/create/adhoc",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

/**
 * Assign a courier and AWB to an existing shipment.
 */
export async function assignShiprocketAwb(
  shipmentId: number,
  courierId?: number,
): Promise<ShiprocketAwbResponse> {
  if (!Number.isInteger(shipmentId) || shipmentId <= 0) {
    throw new Error("INVALID_SHIPROCKET_SHIPMENT_ID");
  }

  return shiprocketRequest<ShiprocketAwbResponse>(
    "/courier/assign/awb",
    {
      method: "POST",
      body: JSON.stringify({
        shipment_id: shipmentId,
        ...(courierId ? { courier_id: courierId } : {}),
      }),
    },
  );
}

/**
 * Request pickup after an AWB has been assigned.
 */
export async function scheduleShiprocketPickup(
  shipmentId: number,
): Promise<ShiprocketPickupResponse> {
  if (!Number.isInteger(shipmentId) || shipmentId <= 0) {
    throw new Error("INVALID_SHIPROCKET_SHIPMENT_ID");
  }

  return shiprocketRequest<ShiprocketPickupResponse>(
    "/courier/generate/pickup",
    {
      method: "POST",
      body: JSON.stringify({
        shipment_id: shipmentId,
      }),
    },
  );
}

/**
 * Generate a manifest after AWB assignment and pickup request.
 */
export async function generateShiprocketManifest(
  shipmentId: number,
): Promise<ShiprocketManifestResponse> {
  if (!Number.isInteger(shipmentId) || shipmentId <= 0) {
    throw new Error("INVALID_SHIPROCKET_SHIPMENT_ID");
  }

  return shiprocketRequest<ShiprocketManifestResponse>(
    "/manifests/generate",
    {
      method: "POST",
      body: JSON.stringify({
        shipment_id: [shipmentId],
      }),
    },
  );
}

/**
 * Fetch the latest Shiprocket order details.
 * Useful for reconciliation if an API request times out.
 */
export async function getShiprocketOrder(
  shiprocketOrderId: number,
): Promise<Record<string, unknown>> {
  if (!Number.isInteger(shiprocketOrderId) || shiprocketOrderId <= 0) {
    throw new Error("INVALID_SHIPROCKET_ORDER_ID");
  }

  return shiprocketRequest<Record<string, unknown>>(
    `/orders/show/${shiprocketOrderId}`,
    {
      method: "GET",
    },
  );
}