-- Add the new single-name field.
ALTER TABLE "User"
ADD COLUMN "name" TEXT;

-- Preserve existing customer names before making the new field required.
UPDATE "User"
SET "name" = COALESCE(
  NULLIF(
    BTRIM(CONCAT_WS(' ', "firstName", "lastName")),
    ''
  ),
  'Customer'
);

ALTER TABLE "User"
ALTER COLUMN "name" SET NOT NULL;

-- These fields remain available for existing legacy accounts,
-- but are no longer mandatory for new OTP-only customers.
ALTER TABLE "User"
ALTER COLUMN "email" DROP NOT NULL,
ALTER COLUMN "firstName" DROP NOT NULL,
ALTER COLUMN "lastName" DROP NOT NULL,
ALTER COLUMN "passwordHash" DROP NOT NULL;