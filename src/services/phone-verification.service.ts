import { env } from "../config/env";

const TWILIO_BASE_URL = "https://verify.twilio.com/v2";

export class PhoneVerificationError extends Error {
  status: number;
  providerCode?: number;

  constructor(
    message: string,
    status = 502,
    providerCode?: number,
  ) {
    super(message);
    this.name = "PhoneVerificationError";
    this.status = status;
    this.providerCode = providerCode;
  }
}

function normalizeIndianPhone(phone: string): string {
  const normalized = phone.trim();

  if (!/^[6-9]\d{9}$/.test(normalized)) {
    throw new PhoneVerificationError(
      "Invalid Indian phone number",
      400,
    );
  }

  return `+91${normalized}`;
}

function getTwilioAuthorization(): string {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    throw new PhoneVerificationError(
      "OTP service is not configured",
      503,
    );
  }

  return `Basic ${Buffer.from(
    `${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`,
  ).toString("base64")}`;
}

async function twilioRequest(
  path: string,
  body: URLSearchParams,
) {
  if (!env.TWILIO_VERIFY_SERVICE_SID) {
    throw new PhoneVerificationError(
      "OTP service is not configured",
      503,
    );
  }

  const response = await fetch(
    `${TWILIO_BASE_URL}${path}`,
    {
      method: "POST",
      headers: {
        Authorization: getTwilioAuthorization(),
        "Content-Type":
          "application/x-www-form-urlencoded",
      },
      body,
      signal: AbortSignal.timeout(10000),
    },
  );

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const providerCode =
      typeof data?.code === "number"
        ? data.code
        : undefined;

    console.error("TWILIO VERIFY ERROR", {
      status: response.status,
      code: providerCode,
      message: data?.message,
    });

    throw new PhoneVerificationError(
      providerCode === 60203
        ? "Too many OTP attempts. Please wait and try again."
        : providerCode === 60202
          ? "Too many verification attempts. Please request a new OTP later."
          : "Unable to send verification code",
      response.status === 429 ? 429 : 502,
      providerCode,
    );
  }

  return data;
}

export async function sendPhoneVerification(
  phone: string,
) {
  const to = normalizeIndianPhone(phone);

  const body = new URLSearchParams({
    To: to,
    Channel: "sms",
  });

  return twilioRequest(
    `/Services/${env.TWILIO_VERIFY_SERVICE_SID}/Verifications`,
    body,
  );
}

export async function verifyPhoneCode(
  phone: string,
  code: string,
) {
  const to = normalizeIndianPhone(phone);

  const body = new URLSearchParams({
    To: to,
    Code: code,
  });

  return twilioRequest(
    `/Services/${env.TWILIO_VERIFY_SERVICE_SID}/VerificationCheck`,
    body,
  );
}