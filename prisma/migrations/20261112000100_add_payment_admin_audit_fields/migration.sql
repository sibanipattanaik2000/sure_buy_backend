-- Add admin audit fields to Payment.
-- Safe for existing production payment records.

ALTER TABLE "Payment"
ADD COLUMN IF NOT EXISTS "recordedByUserId" TEXT,
ADD COLUMN IF NOT EXISTS "referenceNote" TEXT;