-- CreateTable
CREATE TABLE "ChannexWebhookLog" (
    "id" TEXT NOT NULL,
    "event" TEXT,
    "payload" TEXT NOT NULL,
    "headers" TEXT,
    "processedOk" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "reservationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannexWebhookLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChannexWebhookLog_createdAt_idx" ON "ChannexWebhookLog"("createdAt");

-- CreateIndex
CREATE INDEX "ChannexWebhookLog_processedOk_idx" ON "ChannexWebhookLog"("processedOk");
