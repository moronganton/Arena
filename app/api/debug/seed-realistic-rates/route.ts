import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireDebugAccess } from "@/lib/debug-auth";
import { enqueueAriUpdate } from "@/lib/channels/ari-outbox";

// Gives a Channex property a rate calendar that looks like a real listing
// rather than a placeholder, which certification requires in as many words:
// "the data on the Test Property should be similar to that of a Live Hotel
// with different inventory/rate/restriction values for multiple days of the
// year... We don't want to see a full sync with all rooms with 1
// availability and 100 USD as example."
//
// A flat base rate with one test rule produces exactly the uniform pattern
// they reject, and it would show up across the whole 500-day full sync.
//
// What it builds, layered by priority (lowest applies first, highest wins -
// see resolvePrice in rate-materializer.ts):
//
//   10  SEASONAL   absolute price per season, with a season-appropriate
//                  minimum stay
//   20  WEEKEND    percentage uplift on Fri/Sat, so it rides on top of
//                  whatever season it lands in instead of flattening it
//   30  SEASONAL   holiday premium, absolute, overriding the season beneath
//
// Seasons are generated for EVERY calendar year the 500-day horizon touches.
// Seeding only the current year would leave the tail of the horizon falling
// back to the flat base rate - which is the very pattern this exists to
// avoid, just pushed further out where it is easier to miss.
//
// Dry run by default. Nothing is written unless &apply=true.
//
//   GET /api/debug/seed-realistic-rates?propertyId=xxx
//   GET /api/debug/seed-realistic-rates?propertyId=xxx&apply=true

const SEED_PREFIX = "[seed]"; // lets a re-run replace its own rules and nothing else
const HORIZON_DAYS = 500; // matches the full-sync window certification asks for

interface SeasonSpec {
  label: string;
  // Month/day boundaries within a year, inclusive. Seasons that wrap the new
  // year are expressed as two entries rather than a wrapping range, which
  // keeps the date maths honest.
  from: [number, number];
  to: [number, number];
  price: number;
  minNights: number;
}

// Multipliers on the property's own base rate rather than hardcoded amounts,
// so this stays sensible whatever the base is set to.
function seasonsFor(base: number): SeasonSpec[] {
  const at = (m: number) => Math.round(base * m);
  return [
    { label: "Winter low", from: [1, 7], to: [3, 15], price: at(0.85), minNights: 2 },
    { label: "Spring shoulder", from: [3, 16], to: [5, 31], price: at(1.1), minNights: 2 },
    { label: "Summer high", from: [6, 1], to: [8, 31], price: at(1.45), minNights: 3 },
    { label: "Autumn shoulder", from: [9, 1], to: [10, 31], price: at(1.15), minNights: 2 },
    { label: "Late autumn low", from: [11, 1], to: [12, 19], price: at(0.9), minNights: 2 },
  ];
}

function utc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

export async function GET(req: NextRequest) {
  const access = await requireDebugAccess(req);
  if (!access.ok) return access.response;

  const { searchParams } = new URL(req.url);
  const propertyId = searchParams.get("propertyId");
  const apply = searchParams.get("apply") === "true";

  if (!propertyId) {
    const properties = await prisma.property.findMany({
      where: { ownerId: access.userId, channelProvider: "CHANNEX" },
      select: { id: true, name: true, basePrice: true, currency: true },
    });
    return NextResponse.json({ error: "propertyId is required - pick one below", properties });
  }

  const property = await prisma.property.findFirst({
    where: { id: propertyId, ownerId: access.userId },
    select: { id: true, name: true, basePrice: true, currency: true, channelProvider: true },
  });
  if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });
  if (property.channelProvider !== "CHANNEX") {
    return NextResponse.json(
      { error: `${property.name} is on ${property.channelProvider}, not CHANNEX - seeding it would push nothing` },
      { status: 400 }
    );
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const horizonEnd = addDays(today, HORIZON_DAYS);
  const years: number[] = [];
  for (let y = today.getUTCFullYear(); y <= horizonEnd.getUTCFullYear(); y++) years.push(y);

  const base = property.basePrice;
  const planned: Array<{
    name: string;
    ruleType: string;
    startDate: Date;
    endDate: Date;
    price?: number;
    adjustment?: number;
    adjType?: string;
    minNights: number;
    priority: number;
    daysOfWeek?: string;
  }> = [];

  for (const year of years) {
    for (const s of seasonsFor(base)) {
      const startDate = utc(year, s.from[0], s.from[1]);
      const endDate = utc(year, s.to[0], s.to[1]);
      // Skip a season entirely outside the horizon - no point creating rules
      // for dates no push will ever cover.
      if (endDate < today || startDate > horizonEnd) continue;
      planned.push({
        name: `${SEED_PREFIX} ${s.label} ${year}`,
        ruleType: "SEASONAL",
        startDate,
        endDate,
        price: s.price,
        minNights: s.minNights,
        priority: 10,
      });
    }

    // Christmas through Epiphany, spanning the year boundary. Priority 30 so
    // it beats both the season under it and the weekend uplift.
    const holidayStart = utc(year, 12, 20);
    const holidayEnd = utc(year + 1, 1, 6);
    if (!(holidayEnd < today || holidayStart > horizonEnd)) {
      planned.push({
        name: `${SEED_PREFIX} Festive peak ${year}/${year + 1}`,
        ruleType: "SEASONAL",
        startDate: holidayStart,
        endDate: holidayEnd,
        price: Math.round(base * 2.1),
        minNights: 4,
        priority: 30,
      });
    }
  }

  // One weekend rule across the whole horizon. A percentage adjustment rather
  // than an absolute price is the point: it rides on top of whichever season
  // the date falls in, so a summer Saturday and a winter Saturday differ,
  // which is what a real calendar looks like.
  planned.push({
    name: `${SEED_PREFIX} Weekend uplift`,
    ruleType: "WEEKEND",
    startDate: today,
    endDate: horizonEnd,
    adjustment: 18,
    adjType: "PERCENT",
    daysOfWeek: JSON.stringify([5, 6]), // Fri, Sat (Sun=0)
    minNights: 1,
    priority: 20,
  });

  // A couple of short maintenance closures, so availability varies too rather
  // than reading as "1 everywhere" - the other half of what certification
  // calls placeholder-looking data.
  //
  // Deliberately pinned to shoulder and low season rather than a raw offset
  // from today. An offset happened to put one on 20 December, the opening day
  // of the festive peak: valid data, but no real operator closes for a deep
  // clean at their highest rate of the year, and implausible data invites
  // exactly the scrutiny this whole exercise is meant to avoid.
  const plannedBlocks = [
    { monthDay: [9, 24] as [number, number], nights: 3, reason: `${SEED_PREFIX} deep clean` },
    { monthDay: [1, 27] as [number, number], nights: 3, reason: `${SEED_PREFIX} maintenance` },
  ]
    .flatMap(({ monthDay, nights, reason }) =>
      years.map((year) => {
        const startDate = utc(year, monthDay[0], monthDay[1]);
        return { startDate, endDate: addDays(startDate, nights), reason };
      })
    )
    .filter((b) => b.endDate > today && b.startDate < horizonEnd);

  const existingSeeded = await prisma.pricingRule.findMany({
    where: { propertyId: property.id, name: { startsWith: SEED_PREFIX } },
    select: { id: true },
  });
  const existingOther = await prisma.pricingRule.findMany({
    where: { propertyId: property.id, NOT: { name: { startsWith: SEED_PREFIX } } },
    select: { id: true, name: true, price: true, startDate: true, endDate: true, priority: true },
  });

  if (!apply) {
    // A worked example beats a rule list: this is what the guest-facing
    // number actually becomes on a handful of representative dates.
    const samples = [0, 3, 40, 100, 200, 300, 400, 480].map((offset) => {
      const d = addDays(today, offset);
      return { date: d.toISOString().slice(0, 10), weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()] };
    });

    return NextResponse.json({
      mode: "dry run - nothing has been changed",
      property: property.name,
      baseRate: `${property.currency} ${base}`,
      horizon: `${today.toISOString().slice(0, 10)} -> ${horizonEnd.toISOString().slice(0, 10)} (${HORIZON_DAYS} days)`,
      wouldCreateRules: planned.length,
      wouldCreateBlocks: plannedBlocks.length,
      wouldReplaceOwnPreviousSeedRules: existingSeeded.length,
      // Named explicitly because they are NOT touched - a re-run replaces
      // only what this endpoint created.
      yourOwnRulesLeftAlone: existingOther,
      sampleDatesToCheckAfterApplying: samples,
      rules: planned.map((p) => ({
        name: p.name,
        period: `${p.startDate.toISOString().slice(0, 10)} -> ${p.endDate.toISOString().slice(0, 10)}`,
        rate: p.price != null ? `${property.currency} ${p.price}` : `${p.adjustment! > 0 ? "+" : ""}${p.adjustment}%`,
        minNights: p.minNights,
        priority: p.priority,
        days: p.daysOfWeek ?? "all",
      })),
      blocks: plannedBlocks.map((b) => ({
        period: `${b.startDate.toISOString().slice(0, 10)} -> ${b.endDate.toISOString().slice(0, 10)}`,
        reason: b.reason,
      })),
      hint: "Re-run with &apply=true. Rates push automatically on the next drain-ari run.",
    });
  }

  // Replace only this endpoint's own previous output, so re-running is safe
  // and never touches a rule the host wrote by hand.
  await prisma.pricingRule.deleteMany({ where: { propertyId: property.id, name: { startsWith: SEED_PREFIX } } });
  await prisma.calendarBlock.deleteMany({ where: { propertyId: property.id, reason: { startsWith: SEED_PREFIX } } });

  for (const p of planned) {
    await prisma.pricingRule.create({
      data: {
        propertyId: property.id,
        name: p.name,
        ruleType: p.ruleType,
        startDate: p.startDate,
        endDate: p.endDate,
        price: p.price,
        adjustment: p.adjustment,
        adjType: p.adjType,
        daysOfWeek: p.daysOfWeek,
        minNights: p.minNights,
        priority: p.priority,
        active: true,
      },
    });
  }

  for (const b of plannedBlocks) {
    await prisma.calendarBlock.create({
      data: { propertyId: property.id, startDate: b.startDate, endDate: b.endDate, reason: b.reason },
    });
  }

  // One push covering the whole horizon. The drain coalesces these into a
  // single call per kind rather than one per rule.
  await enqueueAriUpdate(property.id, today, horizonEnd, "RATE");
  await enqueueAriUpdate(property.id, today, horizonEnd, "RESTRICTION");
  await enqueueAriUpdate(property.id, today, horizonEnd, "AVAILABILITY");

  return NextResponse.json({
    mode: "applied",
    property: property.name,
    rulesCreated: planned.length,
    blocksCreated: plannedBlocks.length,
    ariQueued: "RATE + RESTRICTION + AVAILABILITY across the full horizon",
    next: "Wait for the next drain-ari run, then check /api/debug/cron-health for callsSucceeded.",
  });
}
