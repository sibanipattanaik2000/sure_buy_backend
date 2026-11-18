ALTER TABLE "Order" ADD COLUMN "giftOfferId" TEXT;

CREATE UNIQUE INDEX "Order_giftOfferId_key"
ON "Order"("giftOfferId");

CREATE TABLE "GiftOffer" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "productId" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GiftOffer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GiftOffer_userId_expiresAt_idx"
ON "GiftOffer"("userId", "expiresAt");

CREATE INDEX "GiftOffer_productId_idx"
ON "GiftOffer"("productId");

CREATE TABLE "GiftCard" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "giftName" TEXT,
  "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
  "claimedAt" TIMESTAMP(3),
  "fulfilledAt" TIMESTAMP(3),
  "adminNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GiftCard_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GiftCard_code_key"
ON "GiftCard"("code");

CREATE UNIQUE INDEX "GiftCard_orderId_key"
ON "GiftCard"("orderId");

CREATE INDEX "GiftCard_userId_status_idx"
ON "GiftCard"("userId", "status");

CREATE INDEX "GiftCard_status_createdAt_idx"
ON "GiftCard"("status", "createdAt");