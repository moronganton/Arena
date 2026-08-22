-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "cityTaxPerNight" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "ChannexListing" ADD COLUMN     "paymentInstallationId" TEXT,
ADD COLUMN     "paymentProviderId" TEXT;

-- CreateTable
CREATE TABLE "CityTaxCharge" (
    "id" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "guests" INTEGER NOT NULL,
    "nights" INTEGER NOT NULL,
    "perNightCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "stripeSessionId" TEXT,
    "stripePaymentIntentId" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reservationId" TEXT NOT NULL,

    CONSTRAINT "CityTaxCharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CityTaxCharge_stripeSessionId_key" ON "CityTaxCharge"("stripeSessionId");

-- CreateIndex
CREATE INDEX "CityTaxCharge_reservationId_idx" ON "CityTaxCharge"("reservationId");

-- CreateIndex
CREATE INDEX "CityTaxCharge_status_idx" ON "CityTaxCharge"("status");

-- AddForeignKey
ALTER TABLE "CityTaxCharge" ADD CONSTRAINT "CityTaxCharge_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
