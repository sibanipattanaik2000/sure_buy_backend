require("dotenv/config");

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const products = await prisma.product.findMany({
    where: {
      name: {
        contains: "iPhone 17",
        mode: "insensitive",
      },
    },
    select: {
      id: true,
      name: true,
      slug: true,
      variants: {
        select: {
          id: true,
          color: true,
          storage: true,
          price: true,
          stock: true,
        },
        orderBy: {
          id: "asc",
        },
      },
      images: {
        select: {
          id: true,
          variantId: true,
          url: true,
          key: true,
          position: true,
          type: true,
        },
        orderBy: {
          position: "asc",
        },
      },
    },
  });

  console.dir(products, { depth: null });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
