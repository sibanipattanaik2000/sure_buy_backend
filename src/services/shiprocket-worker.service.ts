import { prisma } from "../config/prisma";
import { processAutomaticShiprocketShipment } from "./auto-shiprocket.service";

const MAX_ATTEMPTS = 8;
const MAX_JOBS_PER_RUN = 5;

const UNCERTAIN_STATUSES = new Set([
  "CREATING",
  "CREATION_UNCERTAIN",
  "AWB_ASSIGNING",
  "AWB_ASSIGNMENT_UNCERTAIN",
  "PICKUP_REQUESTING",
  "PICKUP_REQUEST_UNCERTAIN",
]);

type ClaimedJob = {
  id: string;
  orderId: string;
  attempts: number;
};

async function claimNextJob(): Promise<ClaimedJob | null> {
  return prisma.$transaction(async (tx) => {
    const jobs = await tx.$queryRaw<ClaimedJob[]>`
      SELECT
        "id",
        "orderId",
        "attempts"
      FROM "ShiprocketJob"
      WHERE
        (
          "status" IN ('PENDING', 'RETRY')
          AND "nextAttemptAt" <= NOW()
        )
        OR
        (
          "status" = 'PROCESSING'
          AND "lockedAt" < NOW() - INTERVAL '10 minutes'
        )
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;

    const job = jobs[0];

    if (!job) {
      return null;
    }

    const updated = await tx.shiprocketJob.update({
      where: { id: job.id },
      data: {
        status: "PROCESSING",
        attempts: { increment: 1 },
        lockedAt: new Date(),
        lastError: null,
      },
    });

    return {
      id: updated.id,
      orderId: updated.orderId,
      attempts: updated.attempts,
    };
  });
}

async function markJobCompleted(jobId: string) {
  await prisma.shiprocketJob.update({
    where: { id: jobId },
    data: {
      status: "COMPLETED",
      lockedAt: null,
      lastError: null,
    },
  });
}

async function markJobSkipped(jobId: string, reason: string) {
  await prisma.shiprocketJob.update({
    where: { id: jobId },
    data: {
      status: "SKIPPED",
      lockedAt: null,
      lastError: reason.slice(0, 2000),
    },
  });
}

async function handleJobFailure(
  job: ClaimedJob,
  error: unknown,
) {
  const message =
    error instanceof Error ? error.message : "UNKNOWN_SHIPROCKET_ERROR";

  const order = await prisma.order.findUnique({
    where: { id: job.orderId },
    select: {
      shiprocketStatus: true,
    },
  });

  const currentShiprocketStatus = order?.shiprocketStatus ?? null;

  // Never automatically repeat an operation whose result is uncertain.
  if (
    currentShiprocketStatus &&
    UNCERTAIN_STATUSES.has(currentShiprocketStatus)
  ) {
    await prisma.shiprocketJob.update({
      where: { id: job.id },
      data: {
        status: "MANUAL_REVIEW",
        lockedAt: null,
        lastError: message.slice(0, 2000),
      },
    });

    console.error("SHIPROCKET JOB REQUIRES MANUAL REVIEW:", {
      orderId: job.orderId,
      status: currentShiprocketStatus,
      error: message,
    });

    return;
  }

  if (job.attempts >= MAX_ATTEMPTS) {
    await prisma.shiprocketJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        lockedAt: null,
        lastError: message.slice(0, 2000),
      },
    });

    console.error("SHIPROCKET JOB MAX ATTEMPTS REACHED:", {
      orderId: job.orderId,
      error: message,
    });

    return;
  }

  // Exponential backoff: 2, 4, 8, 16, 32, 60 minutes...
  const delayMinutes = Math.min(
    60,
    2 ** Math.min(job.attempts, 6),
  );

  const nextAttemptAt = new Date(
    Date.now() + delayMinutes * 60 * 1000,
  );

  await prisma.shiprocketJob.update({
    where: { id: job.id },
    data: {
      status: "RETRY",
      nextAttemptAt,
      lockedAt: null,
      lastError: message.slice(0, 2000),
    },
  });

  console.error("SHIPROCKET JOB WILL RETRY:", {
    orderId: job.orderId,
    attempts: job.attempts,
    nextAttemptAt,
    error: message,
  });
}

export async function processShiprocketJobs() {
  let processed = 0;
  let completed = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < MAX_JOBS_PER_RUN; i++) {
    const job = await claimNextJob();

    if (!job) {
      break;
    }

    processed++;

    try {
      const result = await processAutomaticShiprocketShipment(
        job.orderId,
      );

      if (result.success) {
        await markJobCompleted(job.id);
        completed++;
      } else {
        await markJobSkipped(
          job.id,
          result.reason ?? "SHIPMENT_SKIPPED",
        );
        skipped++;
      }
    } catch (error) {
      failed++;
      await handleJobFailure(job, error);
    }
  }

  return {
    processed,
    completed,
    skipped,
    failed,
  };
}