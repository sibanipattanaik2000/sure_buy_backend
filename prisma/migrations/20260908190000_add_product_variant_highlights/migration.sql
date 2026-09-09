-- CreateTable
CREATE TABLE "ProductVariantHighlight" (
    "id" SERIAL NOT NULL,
    "variantId" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductVariantHighlight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductVariantHighlight_variantId_position_idx"
ON "ProductVariantHighlight"("variantId", "position");

-- AddForeignKey
ALTER TABLE "ProductVariantHighlight"
ADD CONSTRAINT "ProductVariantHighlight_variantId_fkey"
FOREIGN KEY ("variantId")
REFERENCES "ProductVariant"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;