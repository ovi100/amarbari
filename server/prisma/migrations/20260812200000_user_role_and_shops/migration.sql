-- Rename Role.TENANT -> Role.USER.
--
-- ALTER TYPE ... RENAME VALUE preserves every existing row: the enum label
-- changes in place, so no data migration and no table rewrite. Prisma's own
-- diff would instead drop and recreate the type, which cannot work while a
-- column depends on it.
ALTER TYPE "Role" RENAME VALUE 'TENANT' TO 'USER';

-- The default was written as 'TENANT'; repoint it at the new label.
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'USER';

-- Rent category discriminator, used by the API and UI to pick a workflow.
CREATE TYPE "RentCategory" AS ENUM ('FLAT', 'SHOP');

-- ---------------------------------------------------------------------------
-- Shop: a commercial unit, parallel to Flat.
-- ---------------------------------------------------------------------------
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "shopName" TEXT NOT NULL,
    "shopNumber" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "isOccupied" BOOLEAN NOT NULL DEFAULT false,
    "baseRent" DOUBLE PRECISION NOT NULL,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Shop_shopNumber_key" ON "Shop"("shopNumber");

-- ---------------------------------------------------------------------------
-- Every record that hangs off a unit gains a nullable shopId, and the existing
-- flatId becomes nullable. Existing rows all have flatId set, so they satisfy
-- the "exactly one" rule below without back-filling.
-- ---------------------------------------------------------------------------
ALTER TABLE "Tenancy" ALTER COLUMN "flatId" DROP NOT NULL;
ALTER TABLE "Tenancy" ADD COLUMN "shopId" TEXT;
ALTER TABLE "Tenancy" ADD CONSTRAINT "Tenancy_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Tenancy_shopId_idx" ON "Tenancy"("shopId");

ALTER TABLE "Invoice" ALTER COLUMN "flatId" DROP NOT NULL;
ALTER TABLE "Invoice" ADD COLUMN "shopId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "serviceCharge" DOUBLE PRECISION NOT NULL DEFAULT 0.0;
ALTER TABLE "Invoice" ADD COLUMN "maintenanceCharge" DOUBLE PRECISION NOT NULL DEFAULT 0.0;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Postgres treats NULLs as distinct in a unique index, so shop invoices
-- (flatId IS NULL) never collide on the flat index, and vice versa.
CREATE UNIQUE INDEX "Invoice_shopId_month_year_key" ON "Invoice"("shopId", "month", "year");

ALTER TABLE "MaintenanceTicket" ALTER COLUMN "flatId" DROP NOT NULL;
ALTER TABLE "MaintenanceTicket" ADD COLUMN "shopId" TEXT;
ALTER TABLE "MaintenanceTicket" ADD CONSTRAINT "MaintenanceTicket_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- BuildingExpense already allowed a null flatId (building-wide costs), so here
-- both null is legal and only "both set" is rejected.
ALTER TABLE "BuildingExpense" ADD COLUMN "shopId" TEXT;
ALTER TABLE "BuildingExpense" ADD CONSTRAINT "BuildingExpense_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- "Exactly one unit" guardrails.
--
-- Prisma cannot express this, and a nullable FK pair is trivially corruptible
-- without it: a row pointing at both a flat and a shop, or at neither, would
-- silently break rent, invoicing and occupancy. Enforced in the database so no
-- code path — including the raw Data Control editor — can bypass it.
-- ---------------------------------------------------------------------------
ALTER TABLE "Tenancy" ADD CONSTRAINT "tenancy_one_unit"
    CHECK (("flatId" IS NOT NULL) <> ("shopId" IS NOT NULL));

ALTER TABLE "Invoice" ADD CONSTRAINT "invoice_one_unit"
    CHECK (("flatId" IS NOT NULL) <> ("shopId" IS NOT NULL));

ALTER TABLE "MaintenanceTicket" ADD CONSTRAINT "ticket_one_unit"
    CHECK (("flatId" IS NOT NULL) <> ("shopId" IS NOT NULL));

-- Building-wide is allowed here, so only reject pointing at both.
ALTER TABLE "BuildingExpense" ADD CONSTRAINT "expense_at_most_one_unit"
    CHECK (NOT ("flatId" IS NOT NULL AND "shopId" IS NOT NULL));
