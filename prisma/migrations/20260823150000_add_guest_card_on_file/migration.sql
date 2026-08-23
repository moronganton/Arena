-- CreateTable
CREATE TABLE "GuestCardOnFile" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "stripeCustomerId" TEXT,
    "stripePaymentMethodId" TEXT,
    "stripeSessionId" TEXT,
    "cardBrand" TEXT,
    "cardLast4" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reservationId" TEXT NOT NULL,

    CONSTRAINT "GuestCardOnFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GuestCardOnFile_stripeSessionId_key" ON "GuestCardOnFile"("stripeSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "GuestCardOnFile_reservationId_key" ON "GuestCardOnFile"("reservationId");

-- AddForeignKey
ALTER TABLE "GuestCardOnFile" ADD CONSTRAINT "GuestCardOnFile_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
