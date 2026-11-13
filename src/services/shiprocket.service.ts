
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
