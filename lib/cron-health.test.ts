import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EXPECTED_INTERVAL_MINUTES, expectedJobs, staleAfterMinutes } from "./cron-health";

const ORIGINAL = process.env.CRON_JOBS_EXPECTED;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CRON_JOBS_EXPECTED;
  else process.env.CRON_JOBS_EXPECTED = ORIGINAL;
});

describe("expectedJobs", () => {
  test("unset means every job, which is what a single-environment deploy wants", () => {
    delete process.env.CRON_JOBS_EXPECTED;
    assert.deepEqual(expectedJobs(), EXPECTED_INTERVAL_MINUTES);
  });

  // The alert this exists to stop: production stopped being pinged for the
  // Channex jobs when that work moved to staging, and the watchdog reported
  // "drain-ari has stopped running" every twenty minutes, correctly and
  // uselessly, forever.
  test("production's list watches the Smoobu jobs and not the Channex ones", () => {
    process.env.CRON_JOBS_EXPECTED = "scheduled-messages,sync-messages,sync-reservations";
    const jobs = Object.keys(expectedJobs());
    assert.deepEqual(jobs.sort(), ["scheduled-messages", "sync-messages", "sync-reservations"]);
    assert.ok(!jobs.includes("drain-ari"), "drain-ari must not be watched where it is not pinged");
  });

  test("staging's list is the mirror image", () => {
    process.env.CRON_JOBS_EXPECTED = "drain-ari,channex-messages,channex-revisions,channex-full-sync";
    const jobs = Object.keys(expectedJobs()).sort();
    assert.deepEqual(jobs, ["channex-full-sync", "channex-messages", "channex-revisions", "drain-ari"]);
  });

  test("intervals survive the filter - a watched job keeps its real schedule", () => {
    process.env.CRON_JOBS_EXPECTED = "drain-ari";
    assert.deepEqual(expectedJobs(), { "drain-ari": 2 });
  });

  test("whitespace and empty entries are tolerated", () => {
    process.env.CRON_JOBS_EXPECTED = " drain-ari , , sync-messages ";
    assert.deepEqual(Object.keys(expectedJobs()).sort(), ["drain-ari", "sync-messages"]);
  });

  // A typo must not silently switch monitoring off. Watching everything is
  // noisy; watching nothing is the failure this whole module exists to
  // prevent.
  test("a list matching nothing falls back to watching everything", () => {
    process.env.CRON_JOBS_EXPECTED = "drain-arri,nonsense";
    assert.deepEqual(expectedJobs(), EXPECTED_INTERVAL_MINUTES);
  });

  test("an empty string is treated as unset", () => {
    process.env.CRON_JOBS_EXPECTED = "   ";
    assert.deepEqual(expectedJobs(), EXPECTED_INTERVAL_MINUTES);
  });

  test("unknown names are ignored rather than invented", () => {
    process.env.CRON_JOBS_EXPECTED = "drain-ari,not-a-real-job";
    assert.deepEqual(expectedJobs(), { "drain-ari": 2 });
  });
});

describe("staleAfterMinutes", () => {
  // The floor matters more than the multiplier on the fast jobs: 2 x 3 = 6
  // minutes would page on a single skipped tick from a free cron pinger.
  test("a two-minute job gets the twenty-minute floor, not six", () => {
    assert.equal(staleAfterMinutes(2), 20);
  });

  test("a daily job scales by the multiplier", () => {
    assert.equal(staleAfterMinutes(1440), 4320);
  });

  test("the floor applies exactly at the crossover", () => {
    assert.equal(staleAfterMinutes(6), 20, "6 x 3 = 18, below the floor");
    assert.equal(staleAfterMinutes(7), 21, "7 x 3 = 21, above it");
  });
});
