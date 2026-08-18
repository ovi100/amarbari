-- DropForeignKey
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_flatId_fkey";

-- DropForeignKey
ALTER TABLE "MaintenanceTicket" DROP CONSTRAINT "MaintenanceTicket_flatId_fkey";

-- DropForeignKey
ALTER TABLE "Tenancy" DROP CONSTRAINT "Tenancy_flatId_fkey";

-- AddForeignKey
ALTER TABLE "Tenancy" ADD CONSTRAINT "Tenancy_flatId_fkey" FOREIGN KEY ("flatId") REFERENCES "Flat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_flatId_fkey" FOREIGN KEY ("flatId") REFERENCES "Flat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceTicket" ADD CONSTRAINT "MaintenanceTicket_flatId_fkey" FOREIGN KEY ("flatId") REFERENCES "Flat"("id") ON DELETE SET NULL ON UPDATE CASCADE;
