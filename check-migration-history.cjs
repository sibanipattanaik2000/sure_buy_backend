require("dotenv/config");

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT
      migration_name,
      finished_at,
      rolled_back_at,
      applied_steps_count
    FROM "_prisma_migrations"
    ORDER BY started_at;
  `);

  console.table(
    rows.map((row) => ({
      migration_name: row.migration_name,
      finished_at: row.finished_at,
      rolled_back_at: row.rolled_back_at,
      applied_steps_count: row.applied_steps_count,
    }))
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
