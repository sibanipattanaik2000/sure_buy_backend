ALTER TABLE "Order"
ADD COLUMN "shiprocketAwbCode" TEXT,
ADD COLUMN "shiprocketCourierName" TEXT,
ADD COLUMN "shiprocketDeliveredAt" TIMESTAMP(3),
ADD COLUMN "shiprocketLastEventAt" TIMESTAMP(3),
ADD COLUMN "shiprocketOrderId" TEXT,
ADD COLUMN "shiprocketPickupScheduledAt" TIMESTAMP(3),
ADD COLUMN "shiprocketShipmentId" TEXT,
ADD COLUMN "shiprocketShippedAt" TIMESTAMP(3),
ADD COLUMN "shiprocketStatus" TEXT,
ADD COLUMN "shiprocketStatusCode" TEXT,
ADD COLUMN "shiprocketTrackingUrl" TEXT;

CREATE UNIQUE INDEX "Order_shiprocketOrderId_key"
ON "Order"("shiprocketOrderId");

CREATE UNIQUE INDEX "Order_shiprocketShipmentId_key"
ON "Order"("shiprocketShipmentId");

CREATE UNIQUE INDEX "Order_shiprocketAwbCode_key"
ON "Order"("shiprocketAwbCode");

CREATE INDEX "Order_shiprocketStatus_idx"
ON "Order"("shiprocketStatus");