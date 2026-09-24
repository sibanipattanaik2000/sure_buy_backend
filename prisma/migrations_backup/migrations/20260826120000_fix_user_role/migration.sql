-- Create WishlistItem table

CREATE TABLE "WishlistItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WishlistItem_pkey" PRIMARY KEY ("id")
);

-- One wishlist entry per user/product

CREATE UNIQUE INDEX "WishlistItem_userId_productId_key"
ON "WishlistItem"("userId", "productId");

-- Indexes

CREATE INDEX "WishlistItem_userId_idx"
ON "WishlistItem"("userId");

CREATE INDEX "WishlistItem_productId_idx"
ON "WishlistItem"("productId");

CREATE INDEX "WishlistItem_createdAt_idx"
ON "WishlistItem"("createdAt");

-- User relation

ALTER TABLE "WishlistItem"
ADD CONSTRAINT "WishlistItem_userId_fkey"
FOREIGN KEY ("userId")
REFERENCES "User"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- Product relation

ALTER TABLE "WishlistItem"
ADD CONSTRAINT "WishlistItem_productId_fkey"
FOREIGN KEY ("productId")
REFERENCES "Product"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
