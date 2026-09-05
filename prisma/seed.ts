import { PrismaClient, ProductCondition } from "@prisma/client";

const prisma = new PrismaClient();

const products = [
  {
    slug: "apple-iphone-17",
    brand: "Apple",
    name: "iPhone 17",
    category: "Smartphones",
    condition: ProductCondition.EXCELLENT,
    price: 79900,
    originalPrice: 89900,
    warranty: "1 Year Apple Warranty",
    description:
      "Apple iPhone 17 with premium design, powerful performance and advanced camera system.",
    rating: 0,
    reviewCount: 0,
    emiFrom: 2999,

    variants: [
      {
        storage: "256GB",
        color: "White",
        price: 79900,
        originalPrice: 89900,
        stock: 100,
      },
      {
        storage: "256GB",
        color: "Lavender",
        price: 79900,
        originalPrice: 89900,
        stock: 100,
      },
    ],

    images: [
      {
        url: "https://media.phonebhai.com/products/iphone-white-17/iphone17-white-full-removebg-preview.png",
        altText: "iPhone 17 White",
        position: 0,
      },
      {
        url: "https://media.phonebhai.com/products/iphone-white-17/whitei17-front-removebg-preview.png",
        altText: "iPhone 17 White rear",
        position: 1,
      },
      {
        url: "https://media.phonebhai.com/products/iphone-white-17/white-back-removebg-preview.webp",
        altText: "iPhone 17 White side",
        position: 2,
      },
      {
        url: "https://media.phonebhai.com/products/iphone-lav-17/iphone-lav-full.png",
        altText: "iPhone 17 Lavender",
        position: 3,
      },
      {
        url: "https://media.phonebhai.com/products/iphone-lav-17/iphone-lav-front.png",
        altText: "iPhone 17 Lavender rear",
        position: 4,
      },
      {
        url: "https://media.phonebhai.com/products/iphone-lav-17/iphone-lav-back.png",
        altText: "iPhone 17 Lavender side",
        position: 5,
      },
    ],

    highlights: [
      "Powerful Apple performance",
      "Advanced camera system",
      "Premium design",
      "USB-C charging",
    ],
  },
];

async function seedProduct(productData: (typeof products)[number]) {
  const { variants, images, highlights, ...product } = productData;

  /*
   * ---------------------------------------------------------
   * PRODUCT
   * ---------------------------------------------------------
   */

  const createdProduct = await prisma.product.upsert({
    where: {
      slug: product.slug,
    },
    update: product,
    create: product,
  });

  /*
   * ---------------------------------------------------------
   * PRODUCT VARIANTS
   * ---------------------------------------------------------
   *
   * IMPORTANT:
   * Never delete variants here.
   *
   * OrderItem.variantId uses onDelete: Restrict because
   * historical orders must keep their original variant.
   *
   * ProductVariant has:
   *
   * @@unique([productId, storage, color])
   *
   * Therefore we can safely upsert using that compound key.
   */

  for (const variant of variants) {
    await prisma.productVariant.upsert({
      where: {
        productId_storage_color: {
          productId: createdProduct.id,
          storage: variant.storage,
          color: variant.color,
        },
      },
      update: {
        price: variant.price,
        originalPrice: variant.originalPrice,
        stock: variant.stock,
      },
      create: {
        productId: createdProduct.id,
        storage: variant.storage,
        color: variant.color,
        price: variant.price,
        originalPrice: variant.originalPrice,
        stock: variant.stock,
      },
    });
  }

  /*
   * ---------------------------------------------------------
   * PRODUCT IMAGES
   * ---------------------------------------------------------
   */

  const variantRecords = await prisma.productVariant.findMany({
    where: {
      productId: createdProduct.id,
    },
    select: {
      id: true,
      color: true,
      storage: true,
    },
  });

  const whiteVariant = variantRecords.find(
    (variant) => variant.color.toLowerCase() === "white",
  );

  const lavenderVariant = variantRecords.find(
    (variant) => variant.color.toLowerCase() === "lavender",
  );

  if (
    createdProduct.slug === "apple-iphone-17" &&
    (!whiteVariant || !lavenderVariant)
  ) {
    throw new Error("iPhone 17 White/Lavender variants were not found.");
  }

  if (createdProduct.slug === "apple-iphone-17") {
    await prisma.productImage.deleteMany({
      where: {
        productId: createdProduct.id,
      },
    });

    const whiteImages = images.filter((image) =>
      image.url.includes("/iphone-white-17/"),
    );

    const lavenderImages = images.filter((image) =>
      image.url.includes("/iphone-lav-17/"),
    );

    await prisma.productImage.createMany({
      data: [
        ...whiteImages.map((image, index) => ({
          productId: createdProduct.id,
          variantId: whiteVariant!.id,
          url: image.url,
          key: image.url.replace("https://media.phonebhai.com/", ""),
          altText: image.altText,
          type: "IMAGE" as const,
          mimeType: "image/png",
          position: index,
        })),

        ...lavenderImages.map((image, index) => ({
          productId: createdProduct.id,
          variantId: lavenderVariant!.id,
          url: image.url,
          key: image.url.replace("https://media.phonebhai.com/", ""),
          altText: image.altText,
          type: "IMAGE" as const,
          mimeType: "image/png",
          position: index,
        })),
      ],
    });
  } else {
    for (const image of images) {
      const existingImage = await prisma.productImage.findFirst({
        where: {
          productId: createdProduct.id,
          position: image.position,
          variantId: null,
        },
      });

      if (existingImage) {
        await prisma.productImage.update({
          where: {
            id: existingImage.id,
          },
          data: {
            url: image.url,
            altText: image.altText,
          },
        });
      } else {
        await prisma.productImage.create({
          data: {
            productId: createdProduct.id,
            url: image.url,
            altText: image.altText,
            position: image.position,
          },
        });
      }
    }
  }

  /*
   * ---------------------------------------------------------
   * PRODUCT HIGHLIGHTS
   * ---------------------------------------------------------
   *
   * Existing highlights are updated by position.
   */

  for (const [position, text] of highlights.entries()) {
    const existingHighlight = await prisma.productHighlight.findFirst({
      where: {
        productId: createdProduct.id,
        position,
      },
    });

    if (existingHighlight) {
      await prisma.productHighlight.update({
        where: {
          id: existingHighlight.id,
        },
        data: {
          text,
        },
      });
    } else {
      await prisma.productHighlight.create({
        data: {
          productId: createdProduct.id,
          text,
          position,
        },
      });
    }
  }

  /*
   * ---------------------------------------------------------
   * LOGGING
   * ---------------------------------------------------------
   */

  const variantCount = await prisma.productVariant.count({
    where: {
      productId: createdProduct.id,
    },
  });

  const imageCount = await prisma.productImage.count({
    where: {
      productId: createdProduct.id,
    },
  });

  const highlightCount = await prisma.productHighlight.count({
    where: {
      productId: createdProduct.id,
    },
  });

  console.log(
    `✓ ${createdProduct.name} | ` +
      `${variantCount} variants | ` +
      `${imageCount} images | ` +
      `${highlightCount} highlights`,
  );
}

async function main() {
  console.log("🌱 Starting product seed...\n");

  for (const productData of products) {
    await seedProduct(productData);
  }

  console.log("\n✅ Product seeding completed successfully.");
}

main()
  .catch((error) => {
    console.error("\n❌ Product seed failed.");

    console.error(error);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
