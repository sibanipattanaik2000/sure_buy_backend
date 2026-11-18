
-- Allow anonymous gift offers.
ALTER TABLE "GiftOffer"
  ALTER COLUMN "userId" DROP NOT NULL;

-- Add persistent visitor identity.
ALTER TABLE "GiftOffer"
  ADD COLUMN IF NOT EXISTS "visitorId" TEXT;

-- Add the index required by the Prisma schema.
CREATE INDEX IF NOT EXISTS
  "GiftOffer_visitorId_productId_expiresAt_idx"
ON "GiftOffer"("visitorId", "productId", "expiresAt");
