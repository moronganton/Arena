-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "password" TEXT,
    "role" TEXT NOT NULL DEFAULT 'OWNER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "offsetDays" INTEGER NOT NULL DEFAULT 0,
    "sendHour" INTEGER NOT NULL DEFAULT 10,
    "subject" TEXT NOT NULL DEFAULT 'Message from your host',
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "propertyId" TEXT,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateImage" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'image/jpeg',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "templateId" TEXT NOT NULL,

    CONSTRAINT "TemplateImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageTemplateSend" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "templateId" TEXT NOT NULL,

    CONSTRAINT "MessageTemplateSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Beds24Account" (
    "id" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "token" TEXT,
    "expiresAt" TIMESTAMP(3),
    "automationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Beds24Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TTLockAccount" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ttlockUid" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "TTLockAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "description" TEXT,
    "bedrooms" INTEGER NOT NULL DEFAULT 1,
    "bathrooms" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "maxGuests" INTEGER NOT NULL DEFAULT 2,
    "basePrice" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "imageUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "aiEnabled" BOOLEAN NOT NULL DEFAULT true,
    "channelProvider" TEXT NOT NULL DEFAULT 'SMOOBU',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT NOT NULL,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannexListing" (
    "id" TEXT NOT NULL,
    "channexPropertyId" TEXT NOT NULL,
    "channexRoomTypeId" TEXT NOT NULL,
    "channexRatePlanId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "propertyId" TEXT NOT NULL,

    CONSTRAINT "ChannexListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyKnowledge" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "propertyId" TEXT NOT NULL,

    CONSTRAINT "PropertyKnowledge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringExpense" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT NOT NULL,
    "propertyId" TEXT,

    CONSTRAINT "RecurringExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerReservationCost" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT NOT NULL,
    "propertyId" TEXT,

    CONSTRAINT "PerReservationCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmoobuAccount" (
    "id" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "automationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "SmoobuAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformFeeSetting" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "percent" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "PlatformFeeSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "date" TIMESTAMP(3) NOT NULL,
    "invoiceImage" TEXT,
    "aiExtracted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "propertyId" TEXT,
    "ownerId" TEXT NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CleaningTask" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "scheduledDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "checkInAt" TIMESTAMP(3),
    "checkInPhotos" TEXT,
    "checkOutAt" TIMESTAMP(3),
    "checkOutPhotos" TEXT,
    "checklist" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "propertyId" TEXT NOT NULL,
    "reservationId" TEXT,

    CONSTRAINT "CleaningTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DamageReport" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "photos" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "propertyId" TEXT NOT NULL,
    "cleaningTaskId" TEXT,

    CONSTRAINT "DamageReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CleaningChecklistItem" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "propertyId" TEXT NOT NULL,

    CONSTRAINT "CleaningChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guest" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Guest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL,
    "confirmationCode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "source" TEXT NOT NULL DEFAULT 'DIRECT',
    "checkIn" TIMESTAMP(3) NOT NULL,
    "checkOut" TIMESTAMP(3) NOT NULL,
    "adults" INTEGER NOT NULL DEFAULT 1,
    "children" INTEGER NOT NULL DEFAULT 0,
    "totalAmount" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "specialRequests" TEXT,
    "internalNotes" TEXT,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "platformCommission" DOUBLE PRECISION,
    "platformCommissionSeenAt" TIMESTAMP(3),
    "propertyId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'INBOUND',
    "channel" TEXT NOT NULL DEFAULT 'PLATFORM',
    "source" TEXT,
    "externalId" TEXT,
    "isAiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "isDraft" BOOLEAN NOT NULL DEFAULT false,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "needsHostReply" BOOLEAN NOT NULL DEFAULT false,
    "taskDone" BOOLEAN NOT NULL DEFAULT false,
    "channelFailed" BOOLEAN NOT NULL DEFAULT false,
    "channelError" TEXT,
    "detectedLanguage" TEXT,
    "translatedBody" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reservationId" TEXT NOT NULL,
    "senderId" TEXT,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelConfig" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "icalUrl" TEXT,
    "apiKey" TEXT,
    "apiSecret" TEXT,
    "listingId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "propertyId" TEXT NOT NULL,

    CONSTRAINT "ChannelConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ruleType" TEXT NOT NULL DEFAULT 'BASE',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "daysOfWeek" TEXT,
    "price" DOUBLE PRECISION,
    "adjustment" DOUBLE PRECISION,
    "adjType" TEXT DEFAULT 'PERCENT',
    "minNights" INTEGER DEFAULT 1,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "propertyId" TEXT NOT NULL,

    CONSTRAINT "PricingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarBlock" (
    "id" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "propertyId" TEXT NOT NULL,

    CONSTRAINT "CalendarBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmartLock" (
    "id" TEXT NOT NULL,
    "ttlockId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "batteryLevel" INTEGER,
    "lockType" TEXT NOT NULL DEFAULT 'PIN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "checkInTime" TEXT NOT NULL DEFAULT '15:00',
    "checkOutTime" TEXT NOT NULL DEFAULT '10:00',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "propertyId" TEXT NOT NULL,

    CONSTRAINT "SmartLock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "codeType" TEXT NOT NULL DEFAULT 'CUSTOM',
    "ttlockKeyId" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sentToGuest" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,

    CONSTRAINT "AccessCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "screenshots" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiSettings" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "autoReplyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "confidenceThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "language" TEXT NOT NULL DEFAULT 'en',
    "customInstructions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "AiSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiHealth" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "lastSuccessAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastErrorType" TEXT,
    "lastErrorMessage" TEXT,
    "reqRemaining" INTEGER,
    "tokensRemaining" INTEGER,
    "tokensLimit" INTEGER,
    "resetAt" TIMESTAMP(3),
    "lastAlertAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "AiHealth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aiSettingsId" TEXT NOT NULL,

    CONSTRAINT "AiTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "MessageTemplate_userId_idx" ON "MessageTemplate"("userId");

-- CreateIndex
CREATE INDEX "TemplateImage_templateId_idx" ON "TemplateImage"("templateId");

-- CreateIndex
CREATE INDEX "MessageTemplateSend_reservationId_idx" ON "MessageTemplateSend"("reservationId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplateSend_templateId_reservationId_key" ON "MessageTemplateSend"("templateId", "reservationId");

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Beds24Account_userId_key" ON "Beds24Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TTLockAccount_userId_key" ON "TTLockAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Property_ownerId_idx" ON "Property"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannexListing_propertyId_key" ON "ChannexListing"("propertyId");

-- CreateIndex
CREATE INDEX "PropertyKnowledge_propertyId_idx" ON "PropertyKnowledge"("propertyId");

-- CreateIndex
CREATE INDEX "RecurringExpense_ownerId_idx" ON "RecurringExpense"("ownerId");

-- CreateIndex
CREATE INDEX "PerReservationCost_ownerId_idx" ON "PerReservationCost"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "SmoobuAccount_userId_key" ON "SmoobuAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformFeeSetting_ownerId_channel_key" ON "PlatformFeeSetting"("ownerId", "channel");

-- CreateIndex
CREATE INDEX "Expense_propertyId_idx" ON "Expense"("propertyId");

-- CreateIndex
CREATE INDEX "Expense_ownerId_date_idx" ON "Expense"("ownerId", "date");

-- CreateIndex
CREATE INDEX "CleaningTask_propertyId_idx" ON "CleaningTask"("propertyId");

-- CreateIndex
CREATE INDEX "DamageReport_propertyId_idx" ON "DamageReport"("propertyId");

-- CreateIndex
CREATE INDEX "CleaningChecklistItem_propertyId_idx" ON "CleaningChecklistItem"("propertyId");

-- CreateIndex
CREATE INDEX "Reservation_propertyId_idx" ON "Reservation"("propertyId");

-- CreateIndex
CREATE INDEX "Reservation_guestId_idx" ON "Reservation"("guestId");

-- CreateIndex
CREATE INDEX "Reservation_checkIn_checkOut_idx" ON "Reservation"("checkIn", "checkOut");

-- CreateIndex
CREATE INDEX "Message_reservationId_idx" ON "Message"("reservationId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelConfig_propertyId_channel_key" ON "ChannelConfig"("propertyId", "channel");

-- CreateIndex
CREATE INDEX "PricingRule_propertyId_idx" ON "PricingRule"("propertyId");

-- CreateIndex
CREATE INDEX "CalendarBlock_propertyId_idx" ON "CalendarBlock"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "SmartLock_ttlockId_key" ON "SmartLock"("ttlockId");

-- CreateIndex
CREATE INDEX "SmartLock_propertyId_idx" ON "SmartLock"("propertyId");

-- CreateIndex
CREATE INDEX "AccessCode_lockId_idx" ON "AccessCode"("lockId");

-- CreateIndex
CREATE INDEX "AccessCode_reservationId_idx" ON "AccessCode"("reservationId");

-- CreateIndex
CREATE INDEX "Feedback_ownerId_idx" ON "Feedback"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "AiSettings_userId_key" ON "AiSettings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AiHealth_userId_key" ON "AiHealth"("userId");

-- AddForeignKey
ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateImage" ADD CONSTRAINT "TemplateImage_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MessageTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageTemplateSend" ADD CONSTRAINT "MessageTemplateSend_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MessageTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Beds24Account" ADD CONSTRAINT "Beds24Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TTLockAccount" ADD CONSTRAINT "TTLockAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannexListing" ADD CONSTRAINT "ChannexListing_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyKnowledge" ADD CONSTRAINT "PropertyKnowledge_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerReservationCost" ADD CONSTRAINT "PerReservationCost_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmoobuAccount" ADD CONSTRAINT "SmoobuAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CleaningTask" ADD CONSTRAINT "CleaningTask_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CleaningTask" ADD CONSTRAINT "CleaningTask_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DamageReport" ADD CONSTRAINT "DamageReport_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DamageReport" ADD CONSTRAINT "DamageReport_cleaningTaskId_fkey" FOREIGN KEY ("cleaningTaskId") REFERENCES "CleaningTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CleaningChecklistItem" ADD CONSTRAINT "CleaningChecklistItem_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelConfig" ADD CONSTRAINT "ChannelConfig_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarBlock" ADD CONSTRAINT "CalendarBlock_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmartLock" ADD CONSTRAINT "SmartLock_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessCode" ADD CONSTRAINT "AccessCode_lockId_fkey" FOREIGN KEY ("lockId") REFERENCES "SmartLock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessCode" ADD CONSTRAINT "AccessCode_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSettings" ADD CONSTRAINT "AiSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiHealth" ADD CONSTRAINT "AiHealth_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiTemplate" ADD CONSTRAINT "AiTemplate_aiSettingsId_fkey" FOREIGN KEY ("aiSettingsId") REFERENCES "AiSettings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

