// Collapsing a hand-picked set of dates into the fewest contiguous ranges.
//
// The calendar lets the operator click individual dates - every Saturday in a
// month, say - and the pricing-rule table stores ranges. One rule per clicked
// date would work but litters the rule list with thirty one-day rules for
// what the operator thinks of as one edit; grouping adjacent picks first
// means a weekend pair becomes one two-day rule and a full-month drag stays a
// single rule, exactly what the range-select flow used to produce.

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DateRange {
  start: string; // YYYY-MM-DD, inclusive
  end: string; // YYYY-MM-DD, inclusive
}

export function groupContiguousDates(dates: string[]): DateRange[] {
  const unique = [...new Set(dates)].sort();
  const ranges: DateRange[] = [];
  for (const d of unique) {
    const last = ranges[ranges.length - 1];
    if (last && new Date(`${d}T00:00:00.000Z`).getTime() - new Date(`${last.end}T00:00:00.000Z`).getTime() === DAY_MS) {
      last.end = d;
    } else {
      ranges.push({ start: d, end: d });
    }
  }
  return ranges;
}

/**
 * The day after a date key.
 *
 * Ranges in this app are half-open - a stay's checkOut and a block's endDate
 * are both the morning after the last night. A calendar selection is a set of
 * NIGHTS, so turning one into a range means adding a day to its last night,
 * and getting that wrong silently drops or adds a night at the end.
 */
export function addDayKey(dateKey: string): string {
  return new Date(new Date(`${dateKey}T00:00:00.000Z`).getTime() + DAY_MS)
    .toISOString()
    .slice(0, 10);
}
