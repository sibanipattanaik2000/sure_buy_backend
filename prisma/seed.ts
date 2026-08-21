import {
  PrismaClient,
  ProductCondition,
} from "@prisma/client";

const prisma = new PrismaClient();

const products = [
  {
    slug: "apple-iphone-15-128gb",
    brand: "Apple",
    name: "iPhone 15",
    category: "iPhone",
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
    category: "Samsung",
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
    category: "OnePlus",
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
    category: "Google",
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

async function main() {
  console.log("🌱 Seeding products...");

  for (const productData of products) {
    const { variants, images, highlights, ...product } = productData;

    const createdProduct = await prisma.product.upsert({
      where: {
        slug: product.slug,
      },
      update: product,
      create: product,
    });

    await prisma.productVariant.deleteMany({
      where: {
        productId: createdProduct.id,
      },
    });

    await prisma.productImage.deleteMany({
      where: {
        productId: createdProduct.id,
      },
    });

    await prisma.productHighlight.deleteMany({
      where: {
        productId: createdProduct.id,
      },
    });

    const createdVariants = await Promise.all(
      variants.map((variant) =>
        prisma.productVariant.create({
          data: {
            productId: createdProduct.id,
            ...variant,
          },
        }),
      ),
    );

    await prisma.productImage.createMany({
      data: images.map((image) => ({
        productId: createdProduct.id,
        ...image,
      })),
    });

    await prisma.productHighlight.createMany({
      data: highlights.map((text, index) => ({
        productId: createdProduct.id,
        text,
        position: index,
      })),
    });

    console.log(
      `✓ ${createdProduct.name} (${createdVariants.length} variants)`,
    );
  }

  console.log("✅ Product seeding completed.");
}

main()
  .catch((error) => {
    console.error("❌ Seed failed:", error);
throw error;  })
  .finally(async () => {
    await prisma.$disconnect();
  });