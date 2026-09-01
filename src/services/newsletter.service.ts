import { prisma } from "../config/prisma";

export async function subscribeToNewsletter(email: string) {
  const normalizedEmail = email.trim().toLowerCase();

  return prisma.newsletterSubscriber.upsert({
    where: {
      email: normalizedEmail,
    },

    create: {
      email: normalizedEmail,
      isActive: true,
    },

    update: {
      isActive: true,
      unsubscribedAt: null,
    },

    select: {
      id: true,
      email: true,
      isActive: true,
      subscribedAt: true,
    },
  });
}