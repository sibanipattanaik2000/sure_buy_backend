import { ProductCondition, MediaType } from "@prisma/client";

import { prisma } from "../config/prisma";

export type CreateAdminProductInput = {
  slug: string;
  brand: string;
  name: string;
  category: string;
  condition: ProductCondition;

  price: number;
  originalPrice: number;

  warranty: string;
  description: string;

  emiFrom?: number | null;
  active?: boolean;

  highlights?: string[];

  variants: Array<{
    storage: string;
    color: string;
    colorHex?: string | null;

    price: number;
    originalPrice: number;

    stock?: number;
  }>;

  media?: Array<{
    variantIndex?: number | null;

    url: string;
    key?: string | null;
    altText?: string | null;

    type: MediaType;
    mimeType?: string | null;
    size?: number | null;

    position?: number;
  }>;
};

function cleanSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cleanText(value: string): string {
  return value.trim();
}

export async function createAdminProduct(input: CreateAdminProductInput) {
  const slug = cleanSlug(input.slug);

  if (!slug) {
    throw new Error("Valid product slug is required");
  }

  if (input.variants.length === 0) {
    throw new Error("At least one product variant is required");
  }

  const existingProduct = await prisma.product.findUnique({
    where: {
      slug,
    },
    select: {
      id: true,
    },
  });

  if (existingProduct) {
    throw new Error(`A product with slug "${slug}" already exists`);
  }

  /*
   * Validate variants before starting the transaction.
   */

  const variantKeys = new Set<string>();

  for (const variant of input.variants) {
    const storage = cleanText(variant.storage);
    const color = cleanText(variant.color);

    if (!storage) {
      throw new Error("Variant storage is required");
    }

    if (!color) {
      throw new Error("Variant color is required");
    }

    const key = `${storage.toLowerCase()}::${color.toLowerCase()}`;

    if (variantKeys.has(key)) {
      throw new Error(`Duplicate variant: ${storage} / ${color}`);
    }

    variantKeys.add(key);

    if (!Number.isFinite(variant.price) || variant.price < 0) {
      throw new Error(`Invalid price for ${storage} / ${color}`);
    }

    if (!Number.isFinite(variant.originalPrice) || variant.originalPrice < 0) {
      throw new Error(`Invalid original price for ${storage} / ${color}`);
    }

    const stock = variant.stock === undefined ? 10 : variant.stock;

    if (!Number.isInteger(stock) || stock < 0) {
      throw new Error(`Invalid stock for ${storage} / ${color}`);
    }
  }

  /*
   * Validate media variant indexes.
   */

  if (input.media) {
    for (const media of input.media) {
      if (media.variantIndex !== undefined && media.variantIndex !== null) {
        if (
          !Number.isInteger(media.variantIndex) ||
          media.variantIndex < 0 ||
          media.variantIndex >= input.variants.length
        ) {
          throw new Error("Invalid variantIndex in product media");
        }
      }

      if (!media.url?.trim()) {
        throw new Error("Media URL is required");
      }

      if (media.key && !media.key.startsWith("products/")) {
        throw new Error("Invalid product media key");
      }
    }
  }

  /*
   * Everything below happens inside one transaction.
   *
   * If anything fails, product + variants +
   * media + highlights are rolled back.
   */

  const product = await prisma.$transaction(async (tx) => {
    const createdProduct = await tx.product.create({
      data: {
        slug,

        brand: cleanText(input.brand),
        name: cleanText(input.name),
        category: cleanText(input.category),

        condition: input.condition,

        price: input.price,
        originalPrice: input.originalPrice,

        warranty: cleanText(input.warranty),
        description: cleanText(input.description),

        emiFrom:
          input.emiFrom === undefined || input.emiFrom === null
            ? null
            : input.emiFrom,

        active: input.active === undefined ? true : input.active,
      },
    });

    /*
     * Create variants.
     *
     * DEFAULT STOCK = 10
     */
    const createdVariants: Array<{
      index: number;
      id: number;
    }> = [];

    for (let index = 0; index < input.variants.length; index++) {
      const variant = input.variants[index];

      if (!variant) {
        throw new Error(`Variant at index ${index} is missing`);
      }

      const createdVariant = await tx.productVariant.create({
        data: {
          productId: createdProduct.id,

          storage: cleanText(variant.storage),

          color: cleanText(variant.color),

          colorHex: variant.colorHex?.trim() || null,

          price: variant.price,

          originalPrice: variant.originalPrice,

          stock: variant.stock === undefined ? 10 : variant.stock,
        },
      });

      createdVariants.push({
        index,
        id: createdVariant.id,
      });
    }
    /*
     * Create highlights.
     */

    const highlights = (input.highlights ?? [])
      .map((text) => text.trim())
      .filter(Boolean);

    if (highlights.length > 0) {
      await tx.productHighlight.createMany({
        data: highlights.map((text, position) => ({
          productId: createdProduct.id,

          text,
          position,
        })),
      });
    }

    /*
     * Create product / variant media.
     */

    if (input.media && input.media.length > 0) {
      const mediaData = input.media.map((media) => {
        let variantId: number | undefined;

        if (media.variantIndex !== undefined && media.variantIndex !== null) {
          const createdVariant = createdVariants.find(
            (item) => item.index === media.variantIndex,
          );

          variantId = createdVariant?.id;
        }

        return {
          productId: createdProduct.id,

          variantId,

          url: media.url.trim(),

          key: media.key?.trim() || null,

          altText: media.altText?.trim() || null,

          type: media.type,

          mimeType: media.mimeType?.trim() || null,

          size: media.size === undefined ? null : media.size,

          position: media.position ?? 0,
        };
      });

      await tx.productImage.createMany({
        data: mediaData,
      });
    }

    return tx.product.findUnique({
      where: {
        id: createdProduct.id,
      },
      include: {
        variants: {
          orderBy: {
            id: "asc",
          },
        },

        images: {
          orderBy: {
            position: "asc",
          },
        },

        highlights: {
          orderBy: {
            position: "asc",
          },
        },
      },
    });
  });

  return product;
}
