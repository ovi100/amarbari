-- ---------------------------------------------------------------------------
-- Meters, meter readings and the activity log.
--
-- Hand-written for the same reason as the shops migration: the "at most one
-- unit" rule on Meter is a CHECK constraint Prisma cannot express, and it has
-- to exist from the moment the table does — otherwise the window between the
-- CREATE TABLE and a later ALTER is a window in which a corrupt row can land.
-- ---------------------------------------------------------------------------

CREATE TABLE "Meter" (
    "id" TEXT NOT NULL,
    "flatId" TEXT,
    "shopId" TEXT,
    "meterName" TEXT NOT NULL,
    "meterNumber" TEXT NOT NULL,
    "currentReading" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "previousReading" DOUBLE PRECISION NOT NULL DEFAULT 0,
    -- NULL means "follow the category default" (10 for a flat, 15 for a shop).
    "perUnitRate" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Meter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Meter_meterNumber_key" ON "Meter"("meterNumber");
CREATE INDEX "Meter_flatId_idx" ON "Meter"("flatId");
CREATE INDEX "Meter_shopId_idx" ON "Meter"("shopId");

ALTER TABLE "Meter" ADD CONSTRAINT "Meter_flatId_fkey"
    FOREIGN KEY ("flatId") REFERENCES "Flat"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Meter" ADD CONSTRAINT "Meter_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A meter is assigned to a flat, to a shop, or to nothing at all — never both.
-- Unlike Tenancy/Invoice this is "at most one", because an unallocated meter in
-- the pool is a normal state (compare `expense_at_most_one_unit`).
ALTER TABLE "Meter" ADD CONSTRAINT "meter_at_most_one_unit"
    CHECK (NOT ("flatId" IS NOT NULL AND "shopId" IS NOT NULL));

-- A dial does not run backwards, and a negative tariff is a typo.
ALTER TABLE "Meter" ADD CONSTRAINT "meter_readings_non_negative"
    CHECK ("currentReading" >= 0 AND "previousReading" >= 0);
ALTER TABLE "Meter" ADD CONSTRAINT "meter_rate_non_negative"
    CHECK ("perUnitRate" IS NULL OR "perUnitRate" >= 0);

-- ---------------------------------------------------------------------------
-- MeterReading: one row per meter per billing month.
-- ---------------------------------------------------------------------------
CREATE TABLE "MeterReading" (
    "id" TEXT NOT NULL,
    "meterId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "previousReading" DOUBLE PRECISION NOT NULL,
    "currentReading" DOUBLE PRECISION NOT NULL,
    "unitsConsumed" DOUBLE PRECISION NOT NULL,
    "perUnitRate" DOUBLE PRECISION NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "recordedById" TEXT,
    "recordedByName" TEXT NOT NULL,
    "recordedByRole" "Role" NOT NULL DEFAULT 'USER',
    "invoiceId" TEXT,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MeterReading_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MeterReading_meterId_month_year_key"
    ON "MeterReading"("meterId", "month", "year");
CREATE INDEX "MeterReading_year_month_idx" ON "MeterReading"("year", "month");

ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_meterId_fkey"
    FOREIGN KEY ("meterId") REFERENCES "Meter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- The reading survives the account that submitted it: this is billing evidence,
-- and `recordedByName` keeps the attribution readable after the FK is nulled.
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_recordedById_fkey"
    FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MeterReading" ADD CONSTRAINT "meter_reading_month_range"
    CHECK ("month" BETWEEN 1 AND 12);
ALTER TABLE "MeterReading" ADD CONSTRAINT "meter_reading_forward"
    CHECK ("currentReading" >= "previousReading");

-- ---------------------------------------------------------------------------
-- ActivityLog: append-only audit trail for every mutation, admin or user.
-- ---------------------------------------------------------------------------
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "actorRole" "Role" NOT NULL DEFAULT 'USER',
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ActivityLog_entity_entityId_idx" ON "ActivityLog"("entity", "entityId");
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");
CREATE INDEX "ActivityLog_actorId_idx" ON "ActivityLog"("actorId");

ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
