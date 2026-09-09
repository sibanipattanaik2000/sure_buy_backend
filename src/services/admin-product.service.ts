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
/* =========================================================
 * ADMIN PRODUCT MANAGEMENT
 * ========================================================= */

export type AdminProductListInput = {
  page?: number;
  limit?: number;
  search?: string;
  includeInactive?: boolean;
};

export type UpdateAdminProductInput = {
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
    /*
     * Existing variants MUST send their database ID.
     * New variants can omit id.
     */
    id?: number;

    storage: string;
    color: string;
    colorHex?: string | null;

    price: number;
    originalPrice: number;

    stock?: number;

    highlights?: string[];
  }>;

  media?: Array<{
    /*
     * For the current edit implementation this remains the
     * frontend variant array index.
     */
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

function createServiceError(
  message: string,
  code: string,
) {
  const error = new Error(message) as Error & {
    code?: string;
  };

  error.code = code;

  return error;
}

/* =========================================================
 * GET ADMIN PRODUCTS
 *
 * Includes active + inactive products by default.
 * Supports search + pagination.
 * ========================================================= */

export async function getAdminProducts(
  input: AdminProductListInput = {},
) {
  const page = Math.max(
    1,
    Number(input.page) || 1,
  );

  const limit = Math.min(
    100,
    Math.max(
      1,
      Number(input.limit) || 20,
    ),
  );

  const search =
    typeof input.search === "string"
      ? input.search.trim()
      : "";

  const includeInactive =
    input.includeInactive !== false;

  const skip = (page - 1) * limit;

  const where = {
    ...(includeInactive
      ? {}
      : {
          active: true,
        }),

    ...(search
      ? {
          OR: [
            {
              name: {
                contains: search,
                mode: "insensitive" as const,
              },
            },
            {
              brand: {
                contains: search,
                mode: "insensitive" as const,
              },
            },
            {
              slug: {
                contains: search,
                mode: "insensitive" as const,
              },
            },
          ],
        }
      : {}),
  };

  const [products, total] =
    await Promise.all([
      prisma.product.findMany({
        where,
        skip,
        take: limit,

        orderBy: {
          createdAt: "desc",
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

            take: 1,
          },

          highlights: {
            orderBy: {
              position: "asc",
            },
          },
        },
      }),

      prisma.product.count({
        where,
      }),
    ]);

  const totalPages =
    Math.ceil(total / limit);

  return {
    products,

    pagination: {
      page,
      limit,
      total,
      totalPages,

      hasNextPage:
        page < totalPages,

      hasPreviousPage:
        page > 1,
    },
  };
}

/* =========================================================
 * GET SINGLE ADMIN PRODUCT
 * ========================================================= */

export async function getAdminProduct(
  productId: number,
) {
  const product =
    await prisma.product.findUnique({
      where: {
        id: productId,
      },

      include: {
        variants: {
          orderBy: {
            id: "asc",
          },

          include: {
            highlights: {
              orderBy: {
                position: "asc",
              },
            },

            images: {
              orderBy: {
                position: "asc",
              },
            },
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

  if (!product) {
    throw createServiceError(
      "Product not found",
      "PRODUCT_NOT_FOUND",
    );
  }

  return product;
}

/* =========================================================
 * VALIDATE UPDATE INPUT
 * ========================================================= */

function validateAdminProductUpdate(
  input: UpdateAdminProductInput,
) {
  if (!input || typeof input !== "object") {
    throw createServiceError(
      "Product data is required",
      "INVALID_PRODUCT_DATA",
    );
  }

  if (!input.slug?.trim()) {
    throw createServiceError(
      "Product slug is required",
      "INVALID_PRODUCT_DATA",
    );
  }

  if (!input.brand?.trim()) {
    throw createServiceError(
      "Product brand is required",
      "INVALID_PRODUCT_DATA",
    );
  }

  if (!input.name?.trim()) {
    throw createServiceError(
      "Product name is required",
      "INVALID_PRODUCT_DATA",
    );
  }

  if (!input.category?.trim()) {
    throw createServiceError(
      "Product category is required",
      "INVALID_PRODUCT_DATA",
    );
  }

  if (!input.warranty?.trim()) {
    throw createServiceError(
      "Product warranty is required",
      "INVALID_PRODUCT_DATA",
    );
  }

  if (!input.description?.trim()) {
    throw createServiceError(
      "Product description is required",
      "INVALID_PRODUCT_DATA",
    );
  }

  if (
    !Number.isFinite(input.price) ||
    input.price < 0
  ) {
    throw createServiceError(
      "Invalid product price",
      "INVALID_PRODUCT_DATA",
    );
  }

  if (
    !Number.isFinite(input.originalPrice) ||
    input.originalPrice < 0
  ) {
    throw createServiceError(
      "Invalid original product price",
      "INVALID_PRODUCT_DATA",
    );
  }

  if (
    !Array.isArray(input.variants) ||
    input.variants.length === 0
  ) {
    throw createServiceError(
      "At least one product variant is required",
      "INVALID_PRODUCT_DATA",
    );
  }

  const variantKeys =
    new Set<string>();

  for (
    const variant of input.variants
  ) {
    const storage =
      cleanText(variant.storage);

    const color =
      cleanText(variant.color);

    if (!storage) {
      throw createServiceError(
        "Variant storage is required",
        "INVALID_PRODUCT_DATA",
      );
    }

    if (!color) {
      throw createServiceError(
        "Variant color is required",
        "INVALID_PRODUCT_DATA",
      );
    }

    const key =
      `${storage.toLowerCase()}::${color.toLowerCase()}`;

    if (variantKeys.has(key)) {
      throw createServiceError(
        `Duplicate variant: ${storage} / ${color}`,
        "INVALID_PRODUCT_DATA",
      );
    }

    variantKeys.add(key);

    if (
      !Number.isFinite(variant.price) ||
      variant.price < 0
    ) {
      throw createServiceError(
        `Invalid price for ${storage} / ${color}`,
        "INVALID_PRODUCT_DATA",
      );
    }

    if (
      !Number.isFinite(
        variant.originalPrice,
      ) ||
      variant.originalPrice < 0
    ) {
      throw createServiceError(
        `Invalid original price for ${storage} / ${color}`,
        "INVALID_PRODUCT_DATA",
      );
    }

    const stock =
      variant.stock === undefined
        ? 0
        : variant.stock;

    if (
      !Number.isInteger(stock) ||
      stock < 0
    ) {
      throw createServiceError(
        `Invalid stock for ${storage} / ${color}`,
        "INVALID_PRODUCT_DATA",
      );
    }
  }

  if (input.media) {
    for (
      const media of input.media
    ) {
      if (
        media.variantIndex !==
          undefined &&
        media.variantIndex !== null
      ) {
        if (
          !Number.isInteger(
            media.variantIndex,
          ) ||
          media.variantIndex < 0 ||
          media.variantIndex >=
            input.variants.length
        ) {
          throw createServiceError(
            "Invalid variantIndex in product media",
            "INVALID_PRODUCT_DATA",
          );
        }
      }

      if (!media.url?.trim()) {
        throw createServiceError(
          "Media URL is required",
          "INVALID_PRODUCT_DATA",
        );
      }

      if (
        media.key &&
        !media.key.startsWith(
          "products/",
        )
      ) {
        throw createServiceError(
          "Invalid product media key",
          "INVALID_PRODUCT_DATA",
        );
      }
    }
  }
}

/* =========================================================
 * UPDATE ADMIN PRODUCT
 *
 * IMPORTANT:
 * We replace variants/highlights/media inside one DB
 * transaction. Existing customer/order records are NOT
 * deleted.
 * ========================================================= */

/* =========================================================
 * UPDATE ADMIN PRODUCT
 *
 * Production-safe PATCH-style update.
 *
 * IMPORTANT:
 * - Existing variant IDs are preserved.
 * - Existing variants are updated in place.
 * - New variants are created.
 * - Removed variants are deleted only when they are not
 *   referenced by carts/orders.
 * - Product highlights can be replaced safely.
 * - Product media DB records can be replaced safely.
 * - active is preserved when omitted.
 * - emiFrom is preserved when omitted.
 * ========================================================= */

export async function updateAdminProduct(
  productId: number,
  input: UpdateAdminProductInput,
) {
  validateAdminProductUpdate(input);

  const slug = cleanSlug(input.slug);

  if (!slug) {
    throw createServiceError(
      "Valid product slug is required",
      "INVALID_PRODUCT_DATA",
    );
  }

  /*
   * ---------------------------------------------------------
   * 1. Verify product exists
   * ---------------------------------------------------------
   */

  const existingProduct = await prisma.product.findUnique({
    where: {
      id: productId,
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

  if (!existingProduct) {
    throw createServiceError(
      "Product not found",
      "PRODUCT_NOT_FOUND",
    );
  }

  /*
   * ---------------------------------------------------------
   * 2. Check duplicate slug
   * ---------------------------------------------------------
   */

  const duplicateSlug = await prisma.product.findFirst({
    where: {
      slug,

      NOT: {
        id: productId,
      },
    },

    select: {
      id: true,
    },
  });

  if (duplicateSlug) {
    throw createServiceError(
      `A product with slug "${slug}" already exists`,
      "DUPLICATE_SLUG",
    );
  }

  /*
   * ---------------------------------------------------------
   * 3. Validate variant IDs before transaction
   * ---------------------------------------------------------
   *
   * This prevents an admin from accidentally sending a
   * variant ID belonging to another product.
   */

  const existingVariantIds = new Set(
    existingProduct.variants.map(
      (variant) => variant.id,
    ),
  );

  const submittedExistingVariantIds = new Set<number>();

  for (const variant of input.variants) {
    if (
      variant.id !== undefined &&
      variant.id !== null
    ) {
      const variantId = Number(variant.id);

      if (
        !Number.isInteger(variantId) ||
        variantId <= 0
      ) {
        throw createServiceError(
          "Invalid variant id",
          "INVALID_VARIANT",
        );
      }

      if (!existingVariantIds.has(variantId)) {
        throw createServiceError(
          `Variant ${variantId} does not belong to this product`,
          "INVALID_VARIANT",
        );
      }

      if (
        submittedExistingVariantIds.has(
          variantId,
        )
      ) {
        throw createServiceError(
          `Variant ${variantId} was submitted more than once`,
          "INVALID_VARIANT",
        );
      }

      submittedExistingVariantIds.add(
        variantId,
      );
    }
  }

  /*
   * ---------------------------------------------------------
   * 4. Transaction
   * ---------------------------------------------------------
   */

  const updatedProduct = await prisma.$transaction(
    async (tx) => {
      /*
       * -----------------------------------------------------
       * PRODUCT
       * -----------------------------------------------------
       *
       * IMPORTANT:
       * Do not default active to true here.
       *
       * If an inactive product is edited without active,
       * it must remain inactive.
       */

      const productData: {
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
      } = {
        slug,

        brand: cleanText(input.brand),

        name: cleanText(input.name),

        category: cleanText(input.category),

        condition: input.condition,

        price: input.price,

        originalPrice: input.originalPrice,

        warranty: cleanText(input.warranty),

        description: cleanText(input.description),
      };

      /*
       * PATCH semantics:
       *
       * undefined = preserve current DB value
       * null      = explicitly clear nullable value
       */

      if (input.emiFrom !== undefined) {
        productData.emiFrom =
          input.emiFrom;
      }

      if (input.active !== undefined) {
        productData.active =
          input.active;
      }

      await tx.product.update({
        where: {
          id: productId,
        },

        data: productData,
      });

      /*
       * -----------------------------------------------------
       * PRODUCT HIGHLIGHTS
       * -----------------------------------------------------
       *
       * Only replace them when the frontend actually sends
       * highlights.
       */

      if (input.highlights !== undefined) {
        await tx.productHighlight.deleteMany({
          where: {
            productId,
          },
        });

        const highlights = input.highlights
          .map((text) => text.trim())
          .filter(Boolean);

        if (highlights.length > 0) {
          await tx.productHighlight.createMany({
            data: highlights.map(
              (text, position) => ({
                productId,
                text,
                position,
              }),
            ),
          });
        }
      }

      /*
       * -----------------------------------------------------
       * VARIANTS
       * -----------------------------------------------------
       *
       * Existing variants:
       *     UPDATE
       *
       * New variants:
       *     CREATE
       *
       * Removed variants:
       *     DELETE only when unused
       */

      for (
        let index = 0;
        index < input.variants.length;
        index++
      ) {
        const variant =
          input.variants[index];

        if (!variant) {
          throw createServiceError(
            `Variant at index ${index} is missing`,
            "INVALID_VARIANT",
          );
        }

        /*
         * ---------------------------------------------------
         * EXISTING VARIANT
         * ---------------------------------------------------
         */

        if (
          variant.id !== undefined &&
          variant.id !== null
        ) {
          const variantId =
            Number(variant.id);

          const existingVariant =
            existingProduct.variants.find(
              (item) =>
                item.id === variantId,
            );

          if (!existingVariant) {
            throw createServiceError(
              `Variant ${variantId} does not belong to this product`,
              "INVALID_VARIANT",
            );
          }

          await tx.productVariant.update({
            where: {
              id: variantId,
            },

            data: {
              storage:
                cleanText(
                  variant.storage,
                ),

              color:
                cleanText(
                  variant.color,
                ),

              colorHex:
                variant.colorHex ===
                undefined
                  ? existingVariant.colorHex
                  : variant.colorHex
                      ?.trim() || null,

              price:
                variant.price,

              originalPrice:
                variant.originalPrice,

              /*
               * IMPORTANT:
               * If stock is omitted, preserve the
               * current stock.
               */
              stock:
                variant.stock ===
                undefined
                  ? existingVariant.stock
                  : variant.stock,
            },
          });

          /*
           * Variant highlights
           */

          if (
            variant.highlights !==
            undefined
          ) {
            await tx.productVariantHighlight.deleteMany(
              {
                where: {
                  variantId,
                },
              },
            );

            const variantHighlights =
              variant.highlights
                .map((text) =>
                  text.trim(),
                )
                .filter(Boolean);

            if (
              variantHighlights.length >
              0
            ) {
              await tx.productVariantHighlight.createMany(
                {
                  data:
                    variantHighlights.map(
                      (
                        text,
                        position,
                      ) => ({
                        variantId,

                        text,

                        position,
                      }),
                    ),
                },
              );
            }
          }

          continue;
        }

        /*
         * ---------------------------------------------------
         * NEW VARIANT
         * ---------------------------------------------------
         */

        const createdVariant =
          await tx.productVariant.create({
            data: {
              productId,

              storage:
                cleanText(
                  variant.storage,
                ),

              color:
                cleanText(
                  variant.color,
                ),

              colorHex:
                variant.colorHex
                  ?.trim() || null,

              price:
                variant.price,

              originalPrice:
                variant.originalPrice,

              /*
               * New variants use the same default
               * as the existing create-product flow.
               */
              stock:
                variant.stock ===
                undefined
                  ? 10
                  : variant.stock,
            },
          });

        /*
         * New variant highlights
         */

        const variantHighlights =
          (
            variant.highlights ??
            []
          )
            .map((text) =>
              text.trim(),
            )
            .filter(Boolean);

        if (
          variantHighlights.length >
          0
        ) {
          await tx.productVariantHighlight.createMany(
            {
              data:
                variantHighlights.map(
                  (
                    text,
                    position,
                  ) => ({
                    variantId:
                      createdVariant.id,

                    text,

                    position,
                  }),
                ),
            },
          );
        }
      }

      /*
       * -----------------------------------------------------
       * REMOVE VARIANTS THAT WERE REMOVED FROM THE FORM
       * -----------------------------------------------------
       *
       * This is the critical production-safety section.
       */

      const variantsToRemove =
        existingProduct.variants.filter(
          (variant) =>
            !submittedExistingVariantIds.has(
              variant.id,
            ),
        );

      for (const variant of variantsToRemove) {
        /*
         * Check cart references.
         */

        const cartItemCount =
          await tx.cartItem.count({
            where: {
              variantId: variant.id,
            },
          });

        /*
         * Check order references.
         */

        const orderItemCount =
          await tx.orderItem.count({
            where: {
              variantId: variant.id,
            },
          });

        if (
          cartItemCount > 0 ||
          orderItemCount > 0
        ) {
          throw createServiceError(
            `Variant "${variant.storage} / ${variant.color}" cannot be removed because it is already referenced by customer cart/order history.`,
            "VARIANT_IN_USE",
          );
        }

        /*
         * Safe to remove.
         *
         * Variant highlights and variant images
         * cascade automatically.
         */

        await tx.productVariant.delete({
          where: {
            id: variant.id,
          },
        });
      }

      /*
       * -----------------------------------------------------
       * PRODUCT MEDIA
       * -----------------------------------------------------
       *
       * DB records can be replaced safely.
       *
       * IMPORTANT:
       * The actual R2 objects are NOT deleted here.
       * R2 cleanup will be handled separately after the
       * transaction succeeds.
       */

      if (input.media !== undefined) {
        await tx.productImage.deleteMany({
          where: {
            productId,
          },
        });

        if (input.media.length > 0) {
          /*
           * At this point variantIndex refers to the
           * frontend submitted variant array.
           *
           * Build a mapping:
           *
           * frontend index -> database variant ID
           */

          const submittedVariantIdMap =
            new Map<number, number>();

          for (
            let index = 0;
            index <
            input.variants.length;
            index++
          ) {
            const variant =
              input.variants[index];

            if (
              !variant
            ) {
              continue;
            }

            if (
              variant.id !==
                undefined &&
              variant.id !== null
            ) {
              submittedVariantIdMap.set(
                index,
                Number(variant.id),
              );
            } else {
              /*
               * New variants were created above.
               *
               * Find them using storage/color.
               */

              const createdVariant =
                await tx.productVariant.findFirst(
                  {
                    where: {
                      productId,

                      storage:
                        cleanText(
                          variant.storage,
                        ),

                      color:
                        cleanText(
                          variant.color,
                        ),
                    },

                    select: {
                      id: true,
                    },
                  },
                );

              if (
                createdVariant
              ) {
                submittedVariantIdMap.set(
                  index,
                  createdVariant.id,
                );
              }
            }
          }

          const mediaData =
            input.media.map(
              (
                media,
                index,
              ) => {
                let variantId:
                  | number
                  | null = null;

                if (
                  media.variantIndex !==
                    undefined &&
                  media.variantIndex !==
                    null
                ) {
                  variantId =
                    submittedVariantIdMap.get(
                      media.variantIndex,
                    ) ??
                    null;
                }

                return {
                  productId,

                  variantId,

                  url:
                    media.url.trim(),

                  key:
                    media.key
                      ?.trim() ||
                    null,

                  altText:
                    media.altText
                      ?.trim() ||
                    null,

                  type:
                    media.type,

                  mimeType:
                    media.mimeType
                      ?.trim() ||
                    null,

                  size:
                    media.size ===
                    undefined
                      ? null
                      : media.size,

                  position:
                    media.position ??
                    index,
                };
              },
            );

          await tx.productImage.createMany({
            data: mediaData,
          });
        }
      }

      /*
       * -----------------------------------------------------
       * RETURN COMPLETE PRODUCT
       * -----------------------------------------------------
       */

      return tx.product.findUnique({
        where: {
          id: productId,
        },

        include: {
          variants: {
            orderBy: {
              id: "asc",
            },

            include: {
              highlights: {
                orderBy: {
                  position: "asc",
                },
              },

              images: {
                orderBy: {
                  position: "asc",
                },
              },
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
    },
  );

  return updatedProduct;
}

/* =========================================================
 * ACTIVATE / DEACTIVATE PRODUCT
 *
 * This is the normal "remove from catalogue" operation.
 * ========================================================= */

export async function updateAdminProductStatus(
  productId: number,
  active: boolean,
) {
  if (
    typeof active !== "boolean"
  ) {
    throw createServiceError(
      "active must be a boolean",
      "INVALID_STATUS",
    );
  }

  const existingProduct =
    await prisma.product.findUnique({
      where: {
        id: productId,
      },

      select: {
        id: true,
      },
    });

  if (!existingProduct) {
    throw createServiceError(
      "Product not found",
      "PRODUCT_NOT_FOUND",
    );
  }

  return prisma.product.update({
    where: {
      id: productId,
    },

    data: {
      active,
    },

    select: {
      id: true,
      slug: true,
      name: true,
      active: true,
      updatedAt: true,
    },
  });
}

/* =========================================================
 * HARD DELETE ADMIN PRODUCT
 *
 * NEVER delete a product that already participates in:
 *
 * - cart
 * - order
 * - sell request
 *
 * Reviews/wishlist are safe because their Product relations
 * are configured with Cascade.
 * ========================================================= */

export async function deleteAdminProduct(
  productId: number,
) {
  const existingProduct =
    await prisma.product.findUnique({
      where: {
        id: productId,
      },

      select: {
        id: true,
        name: true,
        slug: true,
      },
    });

  if (!existingProduct) {
    throw createServiceError(
      "Product not found",
      "PRODUCT_NOT_FOUND",
    );
  }

  const [
    cartItems,
    orderItems,
    sellRequests,
  ] = await Promise.all([
    prisma.cartItem.count({
      where: {
        productId,
      },
    }),

    prisma.orderItem.count({
      where: {
        productId,
      },
    }),

    prisma.sellRequest.count({
      where: {
        productId,
      },
    }),
  ]);

  const blockers: string[] = [];

  if (cartItems > 0) {
    blockers.push(
      `${cartItems} cart item${
        cartItems === 1 ? "" : "s"
      }`,
    );
  }

  if (orderItems > 0) {
    blockers.push(
      `${orderItems} order item${
        orderItems === 1 ? "" : "s"
      }`,
    );
  }

  if (sellRequests > 0) {
    blockers.push(
      `${sellRequests} sell request${
        sellRequests === 1 ? "" : "s"
      }`,
    );
  }

  if (blockers.length > 0) {
    throw createServiceError(
      `This product cannot be permanently deleted because it has existing customer/history records: ${blockers.join(
        ", ",
      )}. Deactivate the product instead.`,
      "PRODUCT_DELETE_BLOCKED",
    );
  }

  /*
   * ProductImage, ProductHighlight,
   * ProductVariant and VariantHighlight records
   * cascade from Product.
   *
   * Reviews and wishlist items also cascade.
   */
  await prisma.product.delete({
    where: {
      id: productId,
    },
  });

  return {
    id: existingProduct.id,
    name: existingProduct.name,
    slug: existingProduct.slug,
  };
}