import { PrismaClient, ProductCondition } from "@prisma/client";

const prisma = new PrismaClient();

const products = [
  {
    slug: "apple-iphone-15-128gb",
    brand: "Apple",
    name: "iPhone 15",
    category: "Smartphones",
    condition: ProductCondition.EXCELLENT,
    price: 54999,
    originalPrice: 69900,
    warranty: "6 Months Warranty",
    description:
      "Apple iPhone 15 with powerful performance, excellent camera and premium design.",
    rating: 4.6,
    reviewCount: 124,
    emiFrom: 1999,

    variants: [
      {
        storage: "128GB",
        color: "Black",
        price: 54999,
        originalPrice: 69900,
        stock: 10,
      },
      {
        storage: "256GB",
        color: "Blue",
        price: 62999,
        originalPrice: 79900,
        stock: 7,
      },
    ],

    images: [
      {
        url: "https://placehold.co/600x600?text=iPhone+15",
        altText: "Apple iPhone 15",
        position: 0,
      },
    ],

    highlights: [
      "A16 Bionic Chip",
      "48MP Main Camera",
      "USB-C Charging",
      "6.1-inch Super Retina Display",
    ],
  },

  {
    slug: "samsung-galaxy-s24-256gb",
    brand: "Samsung",
    name: "Galaxy S24",
    category: "Smartphones",
    condition: ProductCondition.LIKE_NEW,
    price: 49999,
    originalPrice: 74999,
    warranty: "6 Months Warranty",
    description:
      "Samsung Galaxy S24 with flagship performance, AMOLED display and advanced camera system.",
    rating: 4.5,
    reviewCount: 98,
    emiFrom: 1799,

    variants: [
      {
        storage: "256GB",
        color: "Black",
        price: 49999,
        originalPrice: 74999,
        stock: 8,
      },
      {
        storage: "256GB",
        color: "Violet",
        price: 50999,
        originalPrice: 74999,
        stock: 5,
      },
    ],

    images: [
      {
        url: "https://placehold.co/600x600?text=Galaxy+S24",
        altText: "Samsung Galaxy S24",
        position: 0,
      },
    ],

    highlights: [
      "Snapdragon 8 Gen 3",
      "50MP Camera",
      "120Hz AMOLED Display",
      "AI Features",
    ],
  },

  {
    slug: "oneplus-12-256gb",
    brand: "OnePlus",
    name: "OnePlus 12",
    category: "Smartphones",
    condition: ProductCondition.EXCELLENT,
    price: 44999,
    originalPrice: 64999,
    warranty: "6 Months Warranty",
    description:
      "OnePlus 12 with flagship performance, fast charging and a high refresh rate display.",
    rating: 4.4,
    reviewCount: 76,
    emiFrom: 1599,

    variants: [
      {
        storage: "256GB",
        color: "Black",
        price: 44999,
        originalPrice: 64999,
        stock: 12,
      },
    ],

    images: [
      {
        url: "https://placehold.co/600x600?text=OnePlus+12",
        altText: "OnePlus 12",
        position: 0,
      },
    ],

    highlights: [
      "Snapdragon 8 Gen 3",
      "50MP Hasselblad Camera",
      "100W Fast Charging",
      "120Hz Display",
    ],
  },

  {
    slug: "google-pixel-8-128gb",
    brand: "Google",
    name: "Pixel 8",
    category: "Smartphones",
    condition: ProductCondition.GOOD,
    price: 32999,
    originalPrice: 75999,
    warranty: "3 Months Warranty",
    description:
      "Google Pixel 8 with excellent computational photography and clean Android experience.",
    rating: 4.3,
    reviewCount: 61,
    emiFrom: 1199,

    variants: [
      {
        storage: "128GB",
        color: "Black",
        price: 32999,
        originalPrice: 75999,
        stock: 6,
      },
    ],

    images: [
      {
        url: "https://placehold.co/600x600?text=Pixel+8",
        altText: "Google Pixel 8",
        position: 0,
      },
    ],

    highlights: [
      "Google Tensor G3",
      "50MP Main Camera",
      "Pure Android",
      "7 Years of Updates",
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
   *
   * Images are matched by product + position.
   *
   * Existing images are updated instead of deleted.
   */

  for (const image of images) {
    const existingImage = await prisma.productImage.findFirst({
      where: {
        productId: createdProduct.id,
        position: image.position,
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

  /*
   * ---------------------------------------------------------
   * PRODUCT HIGHLIGHTS
   * ---------------------------------------------------------
   *
   * Existing highlights are updated by position.
   */

  for (const [position, text] of highlights.entries()) {
    const existingHighlight =
      await prisma.productHighlight.findFirst({
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