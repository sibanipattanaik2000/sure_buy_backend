
CREATE TABLE "PhoneOtpSecurity" (
    "phone" TEXT NOT NULL,
    "indiaDay" TEXT NOT NULL,
    "sendCount" INTEGER NOT NULL DEFAULT 0,
    "failedVerifyCount" INTEGER NOT NULL DEFAULT 0,
    "otpExpiresAt" TIMESTAMP(3),
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhoneOtpSecurity_pkey" PRIMARY KEY ("phone"),

    CONSTRAINT "PhoneOtpSecurity_sendCount_check"
        CHECK ("sendCount" >= 0 AND "sendCount" <= 3),

    CONSTRAINT "PhoneOtpSecurity_failedVerifyCount_check"
        CHECK ("failedVerifyCount" >= 0 AND "failedVerifyCount" <= 3)
);

CREATE INDEX "PhoneOtpSecurity_indiaDay_idx"
ON "PhoneOtpSecurity"("indiaDay");

CREATE INDEX "PhoneOtpSecurity_otpExpiresAt_idx"
ON "PhoneOtpSecurity"("otpExpiresAt");
