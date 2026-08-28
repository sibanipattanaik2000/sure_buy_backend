/*
  Production reconciliation migration.

  Adds:
  - RefreshToken
  - Payment
  - SellRequest
  - SellRequestMedia
  - SellRequestStatus

  Also reconciles:
  - UserRole USER -> CUSTOMER
  - PaymentMethod adds EMI

  Existing application data is preserved.
*/

-- =========================================================
-- 1. Fix UserRole enum
-- =========================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'UserRole'
    ) THEN

        -- Create the replacement enum.
        CREATE TYPE "UserRole_new" AS ENUM ('CUSTOMER', 'ADMIN');

        -- Change the column using text conversion.
        ALTER TABLE "User"
        ALTER COLUMN "role"
        DROP DEFAULT;

        ALTER TABLE "User"
        ALTER COLUMN "role"
        TYPE "UserRole_new"
        USING (
            CASE
                WHEN "role"::text = 'USER'
                    THEN 'CUSTOMER'
                ELSE "role"::text
            END
        )::"UserRole_new";

        -- Remove old enum.
        DROP TYPE "UserRole";

        -- Rename replacement enum.
        ALTER TYPE "UserRole_new"
        RENAME TO "UserRole";

        -- Restore Prisma default.
        ALTER TABLE "User"
        ALTER COLUMN "role"
        SET DEFAULT 'CUSTOMER'::"UserRole";

    END IF;
END
$$;


-- =========================================================
-- 2. Add EMI to PaymentMethod
-- =========================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'PaymentMethod'
    )
    AND NOT EXISTS (
        SELECT 1
        FROM pg_enum
        WHERE enumtypid = '"PaymentMethod"'::regtype
        AND enumlabel = 'EMI'
    ) THEN
        ALTER TYPE "PaymentMethod"
        ADD VALUE 'EMI';
    END IF;
END
$$;


-- =========================================================
-- 3. Create SellRequestStatus enum
-- =========================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'SellRequestStatus'
    ) THEN
        CREATE TYPE "SellRequestStatus" AS ENUM (
            'DRAFT',
            'SUBMITTED',
            'UNDER_REVIEW',
            'INSPECTION_SCHEDULED',
            'INSPECTED',
            'OFFERED',
            'ACCEPTED',
            'PICKUP_SCHEDULED',
            'PICKED_UP',
            'COMPLETED',
            'CANCELLED',
            'REJECTED'
        );
    END IF;
END
$$;


-- =========================================================
-- 4. Create RefreshToken
-- =========================================================

CREATE TABLE IF NOT EXISTS "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefreshToken_pkey"
        PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS
"RefreshToken_tokenHash_key"
ON "RefreshToken"("tokenHash");

CREATE INDEX IF NOT EXISTS
"RefreshToken_userId_idx"
ON "RefreshToken"("userId");

CREATE INDEX IF NOT EXISTS
"RefreshToken_expiresAt_idx"
ON "RefreshToken"("expiresAt");

CREATE INDEX IF NOT EXISTS
"RefreshToken_revokedAt_idx"
ON "RefreshToken"("revokedAt");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'RefreshToken_userId_fkey'
    ) THEN
        ALTER TABLE "RefreshToken"
        ADD CONSTRAINT "RefreshToken_userId_fkey"
        FOREIGN KEY ("userId")
        REFERENCES "User"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE;
    END IF;
END
$$;


-- =========================================================
-- 5. Create Payment
-- =========================================================

CREATE TABLE IF NOT EXISTS "Payment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,

    "provider" TEXT NOT NULL DEFAULT 'RAZORPAY',

    "providerOrderId" TEXT,
    "providerPaymentId" TEXT,

    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',

    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "method" "PaymentMethod" NOT NULL,

    "signature" TEXT,

    "failureCode" TEXT,
    "failureMessage" TEXT,

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey"
        PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS
"Payment_providerOrderId_key"
ON "Payment"("providerOrderId");

CREATE UNIQUE INDEX IF NOT EXISTS
"Payment_providerPaymentId_key"
ON "Payment"("providerPaymentId");

CREATE INDEX IF NOT EXISTS
"Payment_orderId_idx"
ON "Payment"("orderId");

CREATE INDEX IF NOT EXISTS
"Payment_status_idx"
ON "Payment"("status");

CREATE INDEX IF NOT EXISTS
"Payment_provider_idx"
ON "Payment"("provider");

CREATE INDEX IF NOT EXISTS
"Payment_createdAt_idx"
ON "Payment"("createdAt");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'Payment_orderId_fkey'
    ) THEN
        ALTER TABLE "Payment"
        ADD CONSTRAINT "Payment_orderId_fkey"
        FOREIGN KEY ("orderId")
        REFERENCES "Order"("id")
        ON DELETE RESTRICT
        ON UPDATE CASCADE;
    END IF;
END
$$;


-- =========================================================
-- 6. Create SellRequest
-- =========================================================

CREATE TABLE IF NOT EXISTS "SellRequest" (
    "id" TEXT NOT NULL,

    "userId" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,

    "workingStatus" TEXT NOT NULL,
    "screenCondition" TEXT NOT NULL,
    "deviceCondition" TEXT NOT NULL,
    "batteryCondition" TEXT NOT NULL,

    "estimatedValue" DECIMAL(10,2) NOT NULL,
    "finalValue" DECIMAL(10,2),

    "pickupAddress" TEXT NOT NULL,
    "pickupDate" TIMESTAMP(3) NOT NULL,
    "pickupSlot" TEXT NOT NULL,

    "status" "SellRequestStatus" NOT NULL DEFAULT 'SUBMITTED',

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellRequest_pkey"
        PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS
"SellRequest_userId_idx"
ON "SellRequest"("userId");

CREATE INDEX IF NOT EXISTS
"SellRequest_productId_idx"
ON "SellRequest"("productId");

CREATE INDEX IF NOT EXISTS
"SellRequest_status_idx"
ON "SellRequest"("status");

CREATE INDEX IF NOT EXISTS
"SellRequest_createdAt_idx"
ON "SellRequest"("createdAt");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'SellRequest_userId_fkey'
    ) THEN
        ALTER TABLE "SellRequest"
        ADD CONSTRAINT "SellRequest_userId_fkey"
        FOREIGN KEY ("userId")
        REFERENCES "User"("id")
        ON DELETE RESTRICT
        ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'SellRequest_productId_fkey'
    ) THEN
        ALTER TABLE "SellRequest"
        ADD CONSTRAINT "SellRequest_productId_fkey"
        FOREIGN KEY ("productId")
        REFERENCES "Product"("id")
        ON DELETE RESTRICT
        ON UPDATE CASCADE;
    END IF;
END
$$;


-- =========================================================
-- 7. Create SellRequestMedia
-- =========================================================

CREATE TABLE IF NOT EXISTS "SellRequestMedia" (
    "id" TEXT NOT NULL,

    "sellRequestId" TEXT NOT NULL,

    "url" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SellRequestMedia_pkey"
        PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS
"SellRequestMedia_sellRequestId_key_key"
ON "SellRequestMedia"("sellRequestId", "key");

CREATE INDEX IF NOT EXISTS
"SellRequestMedia_sellRequestId_position_idx"
ON "SellRequestMedia"("sellRequestId", "position");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'SellRequestMedia_sellRequestId_fkey'
    ) THEN
        ALTER TABLE "SellRequestMedia"
        ADD CONSTRAINT "SellRequestMedia_sellRequestId_fkey"
        FOREIGN KEY ("sellRequestId")
        REFERENCES "SellRequest"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE;
    END IF;
END
$$;