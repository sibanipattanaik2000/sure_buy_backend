-- DropIndex
DROP INDEX IF EXISTS "User_role_idx";

-- CreateTable
CREATE TABLE "SellPayment" (
    "id" TEXT NOT NULL,
    "sellRequestId" TEXT NOT NULL,
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

    CONSTRAINT "SellPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SellPayment_providerOrderId_key"
ON "SellPayment"("providerOrderId");

CREATE UNIQUE INDEX "SellPayment_providerPaymentId_key"
ON "SellPayment"("providerPaymentId");

CREATE INDEX "SellPayment_sellRequestId_idx"
ON "SellPayment"("sellRequestId");

CREATE INDEX "SellPayment_status_idx"
ON "SellPayment"("status");

CREATE INDEX "SellPayment_provider_idx"
ON "SellPayment"("provider");

CREATE INDEX "SellPayment_createdAt_idx"
ON "SellPayment"("createdAt");

-- IMPORTANT:
-- SellRequest is created by a later migration.
-- Therefore the foreign key is intentionally NOT created here.
