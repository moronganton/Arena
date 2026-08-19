-- CreateTable
CREATE TABLE "AriOutbox" (
    "id" TEXT NOT NULL,
    "dateFrom" TIMESTAMP(3) NOT NULL,
    "dateTo" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "propertyId" TEXT NOT NULL,

    CONSTRAINT "AriOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AriOutbox_propertyId_status_idx" ON "AriOutbox"("propertyId", "status");

-- CreateIndex
CREATE INDEX "AriOutbox_status_createdAt_idx" ON "AriOutbox"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "AriOutbox" ADD CONSTRAINT "AriOutbox_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
