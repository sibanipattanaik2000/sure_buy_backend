CREATE TABLE "PaymentRefund" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "providerRefundId" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentRefund_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentRefund_requestKey_key"
    ON "PaymentRefund"("requestKey");

CREATE UNIQUE INDEX "PaymentRefund_providerRefundId_key"
    ON "PaymentRefund"("providerRefundId");

CREATE INDEX "PaymentRefund_paymentId_status_idx"
    ON "PaymentRefund"("paymentId", "status");

ALTER TABLE "PaymentRefund"
    ADD CONSTRAINT "PaymentRefund_paymentId_fkey"
    FOREIGN KEY ("paymentId")
    REFERENCES "Payment"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
    
INSERT INTO "PaymentRefund" (
    "id",
    "paymentId",
    "requestKey",
    "providerRefundId",
    "amount",
    "reason",
    "status",
    "createdAt",
    "processedAt"
)
SELECT
    'legacy_' || p."id",
    p."id",
    'legacy_' || p."id",
    p."refundId",
    COALESCE(p."refundAmount", p."amount"),
    p."refundReason",
    'PROCESSED',
    CURRENT_TIMESTAMP,
    p."refundedAt"
FROM "Payment" p
WHERE
    p."refundId" IS NOT NULL
    AND p."status" IN ('PARTIALLY_REFUNDED', 'REFUNDED')
    AND COALESCE(p."refundAmount", 0) > 0
ON CONFLICT DO NOTHING;
