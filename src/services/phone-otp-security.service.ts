
import { prisma } from "../config/prisma";
import {
  sendPhoneVerification,
  verifyPhoneCode,
} from "./phone-verification.service";

const MAX_DAILY_SENDS = 3;
const MAX_DAILY_FAILED_ATTEMPTS = 3;

function getIndiaDay(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function normalizePhone(phone: string): string {
  const normalized = phone.trim();

  if (!/^[6-9]\d{9}$/.test(normalized)) {
    throw new Error("PHONE_NOT_FOUND");
  }

  return normalized;
}

type OtpSecurityRow = {
  sendCount: number;
  failedVerifyCount: number;
  otpExpiresAt: Date | null;
  lastSentAt: Date | null;
};

export async function sendProtectedPhoneOtp(phone: string) {
  const normalizedPhone = normalizePhone(phone);
  const indiaDay = getIndiaDay();

  // Atomically reserve one daily OTP send.
  // An active OTP cannot be resent before its expiry.
  const reserved = await prisma.$queryRaw<OtpSecurityRow[]>`
    INSERT INTO "PhoneOtpSecurity" (
      "phone",
      "indiaDay",
      "sendCount",
      "failedVerifyCount",
      "otpExpiresAt",
      "lastSentAt",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${normalizedPhone},
      ${indiaDay},
      1,
      0,
      NOW() + INTERVAL '120 seconds',
      NOW(),
      NOW(),
      NOW()
    )
    ON CONFLICT ("phone")
    DO UPDATE SET
      "indiaDay" = EXCLUDED."indiaDay",
      "sendCount" = CASE
        WHEN "PhoneOtpSecurity"."indiaDay" <> EXCLUDED."indiaDay"
          THEN 1
        ELSE "PhoneOtpSecurity"."sendCount" + 1
      END,
      "failedVerifyCount" = CASE
        WHEN "PhoneOtpSecurity"."indiaDay" <> EXCLUDED."indiaDay"
          THEN 0
        ELSE "PhoneOtpSecurity"."failedVerifyCount"
      END,
      "otpExpiresAt" = NOW() + INTERVAL '120 seconds',
      "lastSentAt" = NOW(),
      "updatedAt" = NOW()
    WHERE
      "PhoneOtpSecurity"."indiaDay" <> EXCLUDED."indiaDay"
      OR (
        "PhoneOtpSecurity"."sendCount" < ${MAX_DAILY_SENDS}
        AND (
          "PhoneOtpSecurity"."otpExpiresAt" IS NULL
          OR "PhoneOtpSecurity"."otpExpiresAt" <= NOW()
        )
      )
    RETURNING
      "sendCount",
      "failedVerifyCount",
      "otpExpiresAt",
      "lastSentAt"
  `;

  if (reserved.length === 0) {
    const existing = await prisma.phoneOtpSecurity.findUnique({
      where: { phone: normalizedPhone },
    });

    if (
      existing &&
      existing.indiaDay === indiaDay &&
      existing.sendCount >= MAX_DAILY_SENDS
    ) {
      throw new Error("OTP_SEND_LIMIT");
    }

    if (
      existing?.indiaDay === indiaDay &&
      existing.otpExpiresAt &&
      existing.otpExpiresAt.getTime() > Date.now()
    ) {
      throw new Error("OTP_ACTIVE");
    }

    throw new Error("OTP_SEND_LIMIT");
  }

  const reservation = reserved[0];

  if (!reservation || !reservation.lastSentAt) {
    throw new Error("OTP_SEND_FAILED");
  }

  const reservationTime = reservation.lastSentAt;

  // Contact Twilio. Only roll back the reservation if Twilio rejects
  // the send request. Do not roll back if the database update later fails.
  try {
    await sendPhoneVerification(normalizedPhone);
  } catch (error) {
    await prisma.$executeRaw`
      UPDATE "PhoneOtpSecurity"
      SET
        "sendCount" = GREATEST("sendCount" - 1, 0),
        "otpExpiresAt" = NULL,
        "updatedAt" = NOW()
      WHERE
        "phone" = ${normalizedPhone}
        AND "indiaDay" = ${indiaDay}
        AND "lastSentAt" = ${reservationTime}
    `;

    throw error;
  }

  // Start the full 2-minute validity period after Twilio accepts the send.
  // The timestamp condition prevents an older send request from updating
  // a newer OTP reservation.
  const updated = await prisma.$queryRaw<Array<{ otpExpiresAt: Date }>>`
    UPDATE "PhoneOtpSecurity"
    SET
      "otpExpiresAt" = NOW() + INTERVAL '120 seconds',
      "lastSentAt" = NOW(),
      "updatedAt" = NOW()
    WHERE
      "phone" = ${normalizedPhone}
      AND "indiaDay" = ${indiaDay}
      AND "lastSentAt" = ${reservationTime}
    RETURNING "otpExpiresAt"
  `;

  const expiry = updated[0];

  if (!expiry) {
    throw new Error("OTP_SEND_FAILED");
  }

  return {
    phone: normalizedPhone,
    expiresAt: expiry.otpExpiresAt.toISOString(),
    remainingSends: Math.max(
      0,
      MAX_DAILY_SENDS - reservation.sendCount,
    ),
  };
}

export async function verifyProtectedPhoneOtp(
  phone: string,
  code: string,
): Promise<void> {
  const normalizedPhone = normalizePhone(phone);
  const indiaDay = getIndiaDay();

  const security = await prisma.phoneOtpSecurity.findUnique({
    where: { phone: normalizedPhone },
  });

  if (!security || security.indiaDay !== indiaDay) {
    throw new Error("OTP_EXPIRED");
  }

  if (security.failedVerifyCount >= MAX_DAILY_FAILED_ATTEMPTS) {
    throw new Error("OTP_VERIFY_LIMIT");
  }

  if (
    !security.otpExpiresAt ||
    security.otpExpiresAt.getTime() <= Date.now()
  ) {
    throw new Error("OTP_EXPIRED");
  }

  // Remember which OTP generation this verification belongs to.
  const otpGeneration = security.lastSentAt;

  if (!otpGeneration) {
    throw new Error("OTP_EXPIRED");
  }

  // Verify through Twilio. Provider/network errors are allowed to
  // propagate and do not count as incorrect OTP attempts.
  const result = await verifyPhoneCode(normalizedPhone, code);

  if (result?.status !== "approved") {
    // Count an incorrect attempt only against the OTP generation
    // that was originally checked.
    const updatedCount = await prisma.$executeRaw`
      UPDATE "PhoneOtpSecurity"
      SET
        "failedVerifyCount" = "failedVerifyCount" + 1,
        "updatedAt" = NOW()
      WHERE
        "phone" = ${normalizedPhone}
        AND "indiaDay" = ${indiaDay}
        AND "lastSentAt" = ${otpGeneration}
        AND "failedVerifyCount" < ${MAX_DAILY_FAILED_ATTEMPTS}
        AND "otpExpiresAt" > NOW()
    `;

    if (updatedCount === 0) {
      const latest = await prisma.phoneOtpSecurity.findUnique({
        where: { phone: normalizedPhone },
      });

      if (
        latest?.indiaDay === indiaDay &&
        latest.failedVerifyCount >= MAX_DAILY_FAILED_ATTEMPTS
      ) {
        throw new Error("OTP_VERIFY_LIMIT");
      }

      throw new Error("OTP_EXPIRED");
    }

    throw new Error("INVALID_OTP");
  }

  // Consume only the exact OTP generation that was verified.
  const consumed = await prisma.$executeRaw`
    UPDATE "PhoneOtpSecurity"
    SET
      "otpExpiresAt" = NULL,
      "updatedAt" = NOW()
    WHERE
      "phone" = ${normalizedPhone}
      AND "indiaDay" = ${indiaDay}
      AND "lastSentAt" = ${otpGeneration}
      AND "otpExpiresAt" > NOW()
  `;

  if (consumed === 0) {
    throw new Error("OTP_EXPIRED");
  }
}
