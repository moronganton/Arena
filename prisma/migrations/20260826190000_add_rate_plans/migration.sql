-- Rate plan families: one PARENT that ARI is pushed into, plus DERIVED plans
-- Channex recomputes from it. Lifts the one-plan-per-property limit without
-- adding a second price stream.
CREATE TABLE "RatePlan" (
    "id" TEXT NOT NULL,
    "channexRatePlanId" TEXT,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'DERIVED',
    "derivedPercent" DOUBLE PRECISION,
    "minStayArrival" INTEGER NOT NULL DEFAULT 1,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "channexListingId" TEXT NOT NULL,

    CONSTRAINT "RatePlan_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RatePlan_channexListingId_idx" ON "RatePlan"("channexListingId");

ALTER TABLE "RatePlan" ADD CONSTRAINT "RatePlan_channexListingId_fkey"
    FOREIGN KEY ("channexListingId") REFERENCES "ChannexListing"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
