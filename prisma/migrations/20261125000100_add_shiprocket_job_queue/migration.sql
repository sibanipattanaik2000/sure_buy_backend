CREATE TABLE "ShiprocketJob" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiprocketJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShiprocketJob_orderId_key"
ON "ShiprocketJob"("orderId");

CREATE INDEX "ShiprocketJob_status_nextAttemptAt_idx"
ON "ShiprocketJob"("status", "nextAttemptAt");

CREATE INDEX "ShiprocketJob_lockedAt_idx"
ON "ShiprocketJob"("lockedAt");

ALTER TABLE "ShiprocketJob"
ADD CONSTRAINT "ShiprocketJob_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id")
ON DELETE CASCADE ON UPDATE CASCADE;