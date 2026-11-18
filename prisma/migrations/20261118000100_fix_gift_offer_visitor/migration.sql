
-- Allow gift offers to exist before a visitor logs in.
ALTER TABLE "GiftOffer"
  ALTER COLUMN "userId" DROP NOT NULL;

-- Store the persistent anonymous visitor identity.
ALTER TABLE "GiftOffer"
  ADD COLUMN IF NOT EXISTS "visitorId" TEXT;

-- Support finding active offers by visitor and product.
CREATE INDEX IF NOT EXISTS
  "GiftOffer_visitorId_productId_expiresAt_idx"
ON "GiftOffer"("visitorId", "productId", "expiresAt");
