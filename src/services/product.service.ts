import { prisma } from "../config/prisma";
export interface GetProductsParams {
  page: number;
  limit: number;
  search?: string;
  category?: string;
  brand?: string;
  condition?: "EXCELLENT" | "LIKE_NEW" | "GOOD";
  minPrice?: number;
  maxPrice?: number;
  sort?: "price_asc" | "price_desc" | "newest" | "rating";
}

export async function getProducts(params: GetProductsParams) {
  const {
    page,
    limit,
    search,
    category,
    brand,
    condition,
    minPrice,
    maxPrice,
    sort = "newest",
  } = params;

  const skip = (page - 1) * limit;

  const where = {
    active: true,

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
              category: {
                contains: search,
                mode: "insensitive" as const,
              },
            },
          ],
        }
      : {}),

    ...(category
      ? {
          category: {
            equals: category,
            mode: "insensitive" as const,
          },
        }
      : {}),

    ...(brand
      ? {
          brand: {
            equals: brand,
            mode: "insensitive" as const,
          },
        }
      : {}),

    ...(condition
      ? {
          condition,
        }
      : {}),

    ...(minPrice !== undefined || maxPrice !== undefined
      ? {
          price: {
            ...(minPrice !== undefined ? { gte: minPrice } : {}),
            ...(maxPrice !== undefined ? { lte: maxPrice } : {}),
          },
        }
      : {}),
  };

  let orderBy;

  switch (sort) {
    case "price_asc":
      orderBy = { price: "asc" as const };
      break;

    case "price_desc":
      orderBy = { price: "desc" as const };
      break;

    case "rating":
      orderBy = { rating: "desc" as const };
      break;

    case "newest":
    default:
      orderBy = { createdAt: "desc" as const };
      break;
  }

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      include: {
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
        variants: {
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    }),

    prisma.product.count({
      where,
    }),
  ]);

  return {
    products,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNextPage: page < Math.ceil(total / limit),
      hasPreviousPage: page > 1,
    },
  };
}
export async function getProductByIdentifier(
  identifier: string,
) {
  const numericId = Number(identifier);

  const product = await prisma.product.findFirst({
    where: {
      active: true,

      OR: [
        ...(Number.isInteger(numericId) && numericId > 0
          ? [{ id: numericId }]
          : []),

        {
          slug: identifier,
        },
      ],
    },

    include: {
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

      variants: {
        orderBy: {
          createdAt: "asc",
        },

        include: {
          images: {
            orderBy: {
              position: "asc",
            },
          },
        },
      },

      reviews: {
        orderBy: {
          createdAt: "desc",
        },

        take: 20,

        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      },
    },
  });

  return product;
}
