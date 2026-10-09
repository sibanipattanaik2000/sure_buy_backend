
import type { Request, Response } from "express";
import { prisma } from "../config/prisma";

const STORE_URL = "https://www.phonebhai.com";
const SELLER_NAME = "PhoneBhai";

function cleanText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function publicImageUrl(value: string | null | undefined): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);

    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Only publish a condition when the product name or slug explicitly
 * identifies it. The database's EXCELLENT / LIKE_NEW / GOOD values
 * are quality grades, not proof that an item is new or refurbished.
 */

function getExplicitCondition(
  name: string,
  slug: string,
): "new" | "used" | "refurbished" | undefined {
  const text = `${name} ${slug}`.toLowerCase();

  // Refurbished phones
  if (/\b(refurbished|refurb)\b/.test(text)) {
    return "refurbished";
  }

  // Used phones, including open-box and phones with an age listed
  if (
    /\b(used|pre-owned|secondhand|second-hand|open[\s-]*box)\b/.test(
      text,
    ) ||
    /\b\d+\s*(?:month|months|year|years|mo|mos|yr|yrs)\s*old\b/.test(
      text,
    )
  ) {
    return "used";
  }

  // Explicitly identified new phones
  if (/\bnew\b/.test(text)) {
    return "new";
  }

  // Don't guess the condition when the product data is ambiguous.
  return undefined;
}

export async function getOpenAIProductFeed(
  _req: Request,
  res: Response,
): Promise<void> {
  try {
    const products = await prisma.product.findMany({
      where: { active: true },
      orderBy: { id: "asc" },
      include: {
        images: {
          where: {
            type: "IMAGE",
            variantId: null,
          },
          orderBy: { position: "asc" },
        },
        variants: {
          orderBy: { id: "asc" },
          include: {
            images: {
              where: { type: "IMAGE" },
              orderBy: { position: "asc" },
            },
          },
        },
      },
    });

    const lines: string[] = [];

    for (const product of products) {
      const description = cleanText(product.description);
      const brand = cleanText(product.brand);
      const productName = cleanText(product.name);
      const condition = getExplicitCondition(
        productName,
        product.slug,
      );

      for (const variant of product.variants) {
        const price = Number(variant.price.toString());

        if (!Number.isFinite(price) || price <= 0) {
          continue;
        }

        // Prefer this variant's images. Use shared product images only
        // when the variant has no usable images of its own.
        const variantImages = [
          ...new Set(
            variant.images
              .map((image) => publicImageUrl(image.url))
              .filter((url): url is string => Boolean(url)),
          ),
        ];

        const sharedProductImages = [
          ...new Set(
            product.images
              .map((image) => publicImageUrl(image.url))
              .filter((url): url is string => Boolean(url)),
          ),
        ];

        const images =
          variantImages.length > 0
            ? variantImages
            : sharedProductImages;

        // OpenAI requires a valid main image for each feed item.
        if (images.length === 0) {
          continue;
        }

        const variantTitle = [
          cleanText(variant.storage),
          cleanText(variant.color),
        ]
          .filter(Boolean)
          .join(" / ");

        const title = [
          brand,
          productName,
          variantTitle,
          condition,
        ]
          .filter(Boolean)
          .join(" - ")
          .slice(0, 150);

        const item = {
          item_id: `phonebhai-${product.id}-${variant.id}`,
          title,
          description: description.slice(0, 5000),
          url: `${STORE_URL}/buy/${encodeURIComponent(product.slug)}`,
          brand,
          seller_name: SELLER_NAME,
          image_url: images[0],
          availability:
            variant.stock > 0 ? "in_stock" : "out_of_stock",
          price: `${price.toFixed(2)} INR`,
          product_category: cleanText(product.category),
          color: cleanText(variant.color),
          size: cleanText(variant.storage),
          additional_image_urls: images.slice(1),
          review_count: product.reviewCount,
          ...(condition ? { condition } : {}),
          ...(product.reviewCount > 0 &&
          Number(product.rating.toString()) > 0
            ? {
                star_rating: Number(
                  product.rating.toString(),
                ).toFixed(2),
              }
            : {}),
        };

        lines.push(JSON.stringify(item));
      }
    }

    res
      .status(200)
      .set({
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      })
      .send(lines.length > 0 ? `${lines.join("\n")}\n` : "");
  } catch (error) {
    console.error(
      "OpenAI product feed generation failed:",
      error,
    );

    res.status(500).json({
      success: false,
      message: "Unable to generate the product feed",
    });
  }
}