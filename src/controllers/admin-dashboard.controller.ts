import type { Request, Response } from "express";
import { PaymentStatus, UserRole } from "@prisma/client";
import { prisma } from "../config/prisma";

export async function recordPageVisit(req: Request, res: Response) {
  try {
    const { visitId, sessionId, path, type, seconds } = req.body ?? {};

    if (
      typeof visitId !== "string" ||
      !/^[a-f0-9-]{36}$/i.test(visitId) ||
      typeof sessionId !== "string" ||
      !/^[a-f0-9-]{36}$/i.test(sessionId) ||
      typeof path !== "string" ||
      !path.startsWith("/") ||
      path.length > 200 ||
      path.includes("?") ||
      path.startsWith("/admin") ||
      !["view", "heartbeat"].includes(type)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid analytics event",
      });
    }

    if (type === "view") {
      await prisma.pageVisit.upsert({
        where: { visitId },
        create: {
          visitId,
          sessionId,
          path,
        },
        update: {
          lastSeenAt: new Date(),
        },
      });
    } else {
      const duration = Math.min(
        20,
        Math.max(0, Number(seconds) || 0),
      );

      await prisma.pageVisit.updateMany({
        where: {
          visitId,
          sessionId,
        },
        data: {
          durationSeconds: {
            increment: duration,
          },
          lastSeenAt: new Date(),
        },
      });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("ANALYTICS EVENT ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to record analytics",
    });
  }
}

export async function getAdminAnalytics(req: Request, res: Response) {
  try {
    const requestedDays = Number(req.query.days ?? 7);
    const days = [7, 30, 90].includes(requestedDays)
      ? requestedDays
      : 7;

    const startDate = new Date(
      Date.now() - days * 24 * 60 * 60 * 1000,
    );

    const [visits, orders, customers, payments] = await Promise.all([
      prisma.pageVisit.findMany({
        where: {
          createdAt: { gte: startDate },
        },
        select: {
          sessionId: true,
          path: true,
          durationSeconds: true,
          createdAt: true,
        },
      }),

      prisma.order.count({
        where: {
          createdAt: { gte: startDate },
        },
      }),

      prisma.user.count({
        where: {
          role: UserRole.CUSTOMER,
          createdAt: { gte: startDate },
        },
      }),

      prisma.payment.findMany({
        where: {
          createdAt: { gte: startDate },
          status: {
            in: [
              PaymentStatus.PAID,
              PaymentStatus.PARTIALLY_PAID,
            ],
          },
        },
        select: {
          amount: true,
        },
      }),
    ]);

    const sessions = new Set(visits.map((v) => v.sessionId));

    const totalDuration = visits.reduce(
      (sum, visit) => sum + visit.durationSeconds,
      0,
    );

    const pageMap = new Map<
      string,
      { views: number; seconds: number }
    >();

    for (const visit of visits) {
      const current = pageMap.get(visit.path) ?? {
        views: 0,
        seconds: 0,
      };

      current.views += 1;
      current.seconds += visit.durationSeconds;

      pageMap.set(visit.path, current);
    }

    const popularPages = [...pageMap.entries()]
      .map(([path, data]) => ({
        path,
        views: data.views,
        totalSeconds: data.seconds,
        averageSeconds: Math.round(
          data.seconds / Math.max(1, data.views),
        ),
      }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 15);

    const paymentVolume = payments.reduce(
      (sum, payment) => sum + Number(payment.amount),
      0,
    );

    return res.status(200).json({
      success: true,
      data: {
        periodDays: days,
        pageViews: visits.length,
        uniqueVisitors: sessions.size,
        averageSessionPageSeconds: visits.length
          ? Math.round(totalDuration / visits.length)
          : 0,
        orders,
        newCustomers: customers,
        successfulPaymentVolume: Number(paymentVolume.toFixed(2)),
        popularPages,
      },
    });
  } catch (error) {
    console.error("ADMIN ANALYTICS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load analytics",
    });
  }
}

export async function getAdminPayments(req: Request, res: Response) {
  try {
    const search =
      typeof req.query.search === "string"
        ? req.query.search.trim()
        : "";

    if (search.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Search query is too long",
      });
    }

    const payments = await prisma.payment.findMany({
      where: search
        ? {
            OR: [
              { providerPaymentId: { contains: search, mode: "insensitive" } },
              { providerOrderId: { contains: search, mode: "insensitive" } },
              {
                order: {
                  orderNumber: {
                    contains: search,
                    mode: "insensitive",
                  },
                },
              },
              {
                order: {
                  user: {
                    email: { contains: search, mode: "insensitive" },
                  },
                },
              },
              {
                order: {
                  user: {
                    phone: { contains: search },
                  },
                },
              },
            ],
          }
        : {},
      include: {
        refunds: true,
        order: {
          select: {
            id: true,
            orderNumber: true,
            totalAmount: true,
            paymentStatus: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 100,
    });

    return res.status(200).json({
      success: true,
      data: payments,
    });
  } catch (error) {
    console.error("ADMIN PAYMENT ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load payments",
    });
  }
}

export async function searchAdminRecords(req: Request, res: Response) {
  try {
    const q =
      typeof req.query.q === "string"
        ? req.query.q.trim()
        : "";

    if (q.length < 2 || q.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Enter between 2 and 100 characters",
      });
    }

    const [orders, customers] = await Promise.all([
      prisma.order.findMany({
        where: {
          OR: [
            { id: q },
            { orderNumber: { contains: q, mode: "insensitive" } },
            { userId: q },
            {
              user: {
                email: { contains: q, mode: "insensitive" },
              },
            },
            {
              user: {
                phone: { contains: q },
              },
            },
            {
              payments: {
                some: {
                  providerPaymentId: {
                    contains: q,
                    mode: "insensitive",
                  },
                },
              },
            },
            {
              items: {
                some: {
                  imei: { contains: q },
                },
              },
            },
          ],
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
          items: true,
          payments: true,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 25,
      }),

      prisma.user.findMany({
        where: {
          OR: [
            { id: q },
            { email: { contains: q, mode: "insensitive" } },
            { phone: { contains: q } },
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
          ],
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          createdAt: true,
        },
        take: 20,
      }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        orders,
        customers,
      },
    });
  } catch (error) {
    console.error("ADMIN SEARCH ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to search records",
    });
  }
}

export async function updateOrderItemImei(req: Request, res: Response) {
  try {
    const orderId = String(req.params.orderId ?? "");
    const itemId = String(req.params.itemId ?? "");
    const imei =
      typeof req.body?.imei === "string"
        ? req.body.imei.trim()
        : "";

    if (imei && !/^\d{14,16}$/.test(imei)) {
      return res.status(400).json({
        success: false,
        message: "IMEI must contain 14 to 16 digits",
      });
    }

    const item = await prisma.orderItem.findFirst({
      where: {
        id: itemId,
        orderId,
      },
    });

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Order item not found",
      });
    }

    await prisma.orderItem.update({
      where: { id: itemId },
      data: { imei: imei || null },
    });

    return res.status(200).json({
      success: true,
      message: "IMEI updated successfully",
    });
  } catch (error: any) {
    if (error?.code === "P2002") {
      return res.status(409).json({
        success: false,
        message: "This IMEI is already assigned to another item",
      });
    }

    console.error("IMEI UPDATE ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to update IMEI",
    });
  }
}
export async function getAdminCustomers(req: Request, res: Response) {
  try {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 20);
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";

    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      search.length > 100
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid pagination or search parameters",
      });
    }

    const where = {
      role: UserRole.CUSTOMER,
      ...(search
        ? {
            OR: [
              { id: search },
              { firstName: { contains: search, mode: "insensitive" as const } },
              { lastName: { contains: search, mode: "insensitive" as const } },
              { email: { contains: search, mode: "insensitive" as const } },
              { phone: { contains: search } },
            ],
          }
        : {}),
    };

    const [customers, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          createdAt: true,
          _count: {
            select: {
              orders: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        customers: customers.map((customer) => ({
          id: customer.id,
          firstName: customer.firstName,
          lastName: customer.lastName,
          email: customer.email,
          phone: customer.phone,
          createdAt: customer.createdAt,
          totalOrders: customer._count.orders,
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
        },
      },
    });
  } catch (error) {
    console.error("ADMIN CUSTOMERS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load customers",
    });
  }
}