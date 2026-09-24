/*
  Product media metadata

  Existing ProductImage rows are preserved.
  updatedAt receives the migration timestamp for existing rows.
*/

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'VIDEO');

-- AlterTable
ALTER TABLE "ProductImage"
ADD COLUMN "key" TEXT,
ADD COLUMN "mimeType" TEXT,
ADD COLUMN "size" INTEGER,
ADD COLUMN "type" "MediaType" NOT NULL DEFAULT 'IMAGE',
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "ProductImage_type_idx" ON "ProductImage"("type");