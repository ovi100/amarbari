import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

let available: boolean | null = null;

/**
 * Integration specs need a live Postgres. Locally that may not exist, so the
 * suites self-skip rather than fail; CI always provides the service container
 * (see .github/workflows/test.yml) and therefore always runs them.
 */
export async function databaseAvailable(): Promise<boolean> {
  if (available !== null) return available;
  try {
    await prisma.$queryRaw`SELECT 1`;
    available = true;
  } catch {
    available = false;
    console.warn(
      '\n  ⚠  Postgres unreachable — integration specs skipped. ' +
        'Run `docker compose up -d` then `npm run prisma:migrate` to enable them.\n'
    );
  }
  return available;
}

/** Truncates every table between suites, preserving the schema. */
export async function resetDatabase() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "ChatMessage", "MaintenanceTicket", "BuildingExpense",
      "ActivityLog", "MeterReading", "Meter",
      "Invoice", "Tenancy", "Flat", "Shop", "User", "DynamicColumn"
    RESTART IDENTITY CASCADE;
  `);
}
