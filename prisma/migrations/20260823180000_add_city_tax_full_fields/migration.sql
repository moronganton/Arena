-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "cityTaxTitle" TEXT NOT NULL DEFAULT 'City tax',
ADD COLUMN     "cityTaxIsInclusive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cityTaxLogic" TEXT NOT NULL DEFAULT 'per_person_per_night',
ADD COLUMN     "cityTaxType" TEXT NOT NULL DEFAULT 'city_tax',
ADD COLUMN     "cityTaxMaxNights" INTEGER,
ADD COLUMN     "cityTaxSkipNights" INTEGER,
ADD COLUMN     "cityTaxChannexId" TEXT;
