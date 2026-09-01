require("dotenv/config");

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const products = await prisma.product.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      brand: true,
      active: true,
      variants: {
        select: {
          id: true,
          color: true,
          storage: true,
          stock: true,
        },
      },
      images: {
        select: {
          id: true,
          variantId: true,
          url: true,
          key: true,
        },
      },
    },
    orderBy: {
      id: "asc",
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
