CREATE TABLE "UserPhoneVerification" (
    "userId" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPhoneVerification_pkey"
        PRIMARY KEY ("userId"),

    CONSTRAINT "UserPhoneVerification_userId_fkey"
        FOREIGN KEY ("userId")
        REFERENCES "User"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

CREATE INDEX "UserPhoneVerification_verifiedAt_idx"
ON "UserPhoneVerification"("verifiedAt");