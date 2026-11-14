CREATE TABLE "PageVisit" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "durationSeconds" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageVisit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PageVisit_visitId_key"
ON "PageVisit"("visitId");

CREATE INDEX "PageVisit_sessionId_createdAt_idx"
ON "PageVisit"("sessionId", "createdAt");

CREATE INDEX "PageVisit_path_createdAt_idx"
ON "PageVisit"("path", "createdAt");

CREATE INDEX "PageVisit_createdAt_idx"
ON "PageVisit"("createdAt");

ALTER TABLE "OrderItem"
ADD COLUMN "imei" TEXT;

CREATE UNIQUE INDEX "OrderItem_imei_key"
ON "OrderItem"("imei");