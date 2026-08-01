/**
 * SERVER TWIN of src/utils/dateRange.ts - the two must resolve a preset to the
 * same dates or a WhatsApp picture will disagree with the widget it is a
 * picture of. Duplicated rather than imported because src/ and api/ are
 * separate TypeScript projects here (see metricSeries.ts for the same
 * arrangement); change one, change the other.
 */
/**
 * The date window a widget draws, and how a preset resolves to real dates.
 *
 * Every widget stores at most a preset id; the dates themselves are computed
 * fresh on each render. Storing resolved dates instead would freeze "Last 28
 * days" to the 28 days that were current when it was chosen, which is exactly
 * what the athlete does not mean by it.
 *
 * Boundaries are Irish local days throughout (see irelandDate.ts) and weeks
 * start on Monday, matching the athlete's training week - a "This week" widget
 * that began on Sunday would disagree with every weekly total on the site.
 */

import { irelandTodayDateStr } from "./timeContext.js";

export type DateRangeId =
  | "inherit"
  | "custom"
  | "customThroughToday"
  | "customThroughNext7"
  | "last7"
  | "last14"
  | "last28"
  | "last90"
  | "last180"
  | "last365"
  | "last730"
  | "thisWeek"
  | "thisMonth"
  | "thisYear"
  | "lastWeek"
  | "lastMonth"
  | "last3Months"
  | "lastYear"
  | "last2Years"
  | "thisWeekLastYear"
  | "thisMonthLastYear"
  | "nextWeek"
  | "last28Next7"
  | "last90Next21"
  | "last180Next45";

/** Inclusive, both ends `YYYY-MM-DD`. */
export type ResolvedRange = { start: string; end: string };

/**
 * What a widget stores. `custom*` presets carry the dates the athlete picked;
 * every other preset needs nothing beyond its id.
 */
export type WidgetDateRange = {
  id: DateRangeId;
  customStart?: string;
  customEnd?: string;
};

/** The default a widget has when it has never been given one of its own. */
export const INHERIT: DateRangeId = "inherit";

/**
 * A page's own default, chosen in Settings. "inherit" is deliberately absent -
 * there is nothing above a page to inherit from, so offering it there would be
 * a setting that means nothing.
 */
export type PageDateRanges = {
  dashboard?: DateRangeId;
  trends?: DateRangeId;
  coaching?: DateRangeId;
};

export type DashboardPage = keyof PageDateRanges;

export const PAGE_RANGE_FALLBACK: Record<DashboardPage, DateRangeId> = {
  dashboard: "last28",
  trends: "last90",
  coaching: "last90Next21",
};

type PresetDef = { id: DateRangeId; label: string; group: string };

/**
 * Ordered as it is shown. `group` only drives the separators in the picker -
 * the ids are what is stored, so reordering or regrouping here is safe.
 */
export const DATE_RANGE_PRESETS: PresetDef[] = [
  { id: "inherit", label: "Use Dashboard Settings", group: "default" },
  { id: "custom", label: "Custom dates", group: "custom" },
  { id: "customThroughToday", label: "Custom date through today", group: "custom" },
  { id: "customThroughNext7", label: "Custom date through next 7 days", group: "custom" },
  { id: "last7", label: "Last 7 days", group: "trailing" },
  { id: "last14", label: "Last 14 days", group: "trailing" },
  { id: "last28", label: "Last 28 days", group: "trailing" },
  { id: "last90", label: "Last 90 days", group: "trailing" },
  { id: "last180", label: "Last 180 days", group: "trailing" },
  { id: "last365", label: "Last 365 days", group: "trailing" },
  { id: "last730", label: "Last 730 days", group: "trailing" },
  { id: "thisWeek", label: "This week", group: "calendar" },
  { id: "thisMonth", label: "This month", group: "calendar" },
  { id: "thisYear", label: "This year", group: "calendar" },
  { id: "lastWeek", label: "Last week", group: "calendar" },
  { id: "lastMonth", label: "Last month", group: "calendar" },
  { id: "last3Months", label: "Last 3 months", group: "calendar" },
  { id: "lastYear", label: "Last year", group: "calendar" },
  { id: "last2Years", label: "Last 2 years", group: "calendar" },
  { id: "thisWeekLastYear", label: "This week last year", group: "yearAgo" },
  { id: "thisMonthLastYear", label: "This month last year", group: "yearAgo" },
  { id: "nextWeek", label: "Next week", group: "forward" },
  { id: "last28Next7", label: "Last 28 and next 7 days", group: "forward" },
  { id: "last90Next21", label: "Last 90 and next 21 days", group: "forward" },
  { id: "last180Next45", label: "Last 180 and next 45 days", group: "forward" },
];

/** The page-default picker offers everything except "inherit". */
export const PAGE_RANGE_PRESETS = DATE_RANGE_PRESETS.filter((p) => p.id !== "inherit");

export function dateRangeLabel(id: DateRangeId): string {
  return DATE_RANGE_PRESETS.find((p) => p.id === id)?.label ?? id;
}

export function isCustomRange(id: DateRangeId): boolean {
  return id === "custom" || id === "customThroughToday" || id === "customThroughNext7";
}

// Date arithmetic runs on UTC midnights of the already-Irish date string, so
// it never crosses a DST boundary mid-calculation - the string is the source
// of truth, the Date object is only a calculator.
function d(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00Z`);
}

function str(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(dateStr: string, n: number): string {
  const date = d(dateStr);
  date.setUTCDate(date.getUTCDate() + n);
  return str(date);
}

function addMonths(dateStr: string, n: number): string {
  const date = d(dateStr);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + n);
  // Clamp rather than overflow: one month before 31 March is 28 February, not
  // 3 March, which is what setUTCMonth would give on its own.
  const lastOfMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastOfMonth));
  return str(date);
}

function addYears(dateStr: string, n: number): string {
  return addMonths(dateStr, n * 12);
}

/** Monday-start, matching the athlete's training week. */
function startOfWeek(dateStr: string): string {
  const date = d(dateStr);
  const weekday = date.getUTCDay(); // 0 = Sunday
  return addDays(dateStr, -(weekday === 0 ? 6 : weekday - 1));
}

function startOfMonth(dateStr: string): string {
  return `${dateStr.slice(0, 7)}-01`;
}

function endOfMonth(dateStr: string): string {
  const date = d(dateStr);
  return str(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)));
}

function startOfYear(dateStr: string): string {
  return `${dateStr.slice(0, 4)}-01-01`;
}

/**
 * Resolves a stored range to inclusive dates.
 *
 * `today` is injectable so the callers that already know the Irish date do not
 * recompute it, and so this is testable without freezing a clock.
 */
export function resolveDateRange(range: WidgetDateRange, today = irelandTodayDateStr()): ResolvedRange {
  const back = (days: number): ResolvedRange => ({ start: addDays(today, -(days - 1)), end: today });
  const forward = (backDays: number, aheadDays: number): ResolvedRange => ({
    start: addDays(today, -backDays),
    end: addDays(today, aheadDays),
  });

  switch (range.id) {
    case "custom":
      // An unfinished custom range shows today rather than nothing, so a
      // half-filled picker never blanks the widget it belongs to.
      return { start: range.customStart ?? today, end: range.customEnd ?? today };
    case "customThroughToday":
      return { start: range.customStart ?? today, end: today };
    case "customThroughNext7":
      return { start: range.customStart ?? today, end: addDays(today, 7) };

    case "last7":
      return back(7);
    case "last14":
      return back(14);
    case "last28":
      return back(28);
    case "last90":
      return back(90);
    case "last180":
      return back(180);
    case "last365":
      return back(365);
    case "last730":
      return back(730);

    case "thisWeek":
      return { start: startOfWeek(today), end: addDays(startOfWeek(today), 6) };
    case "thisMonth":
      return { start: startOfMonth(today), end: endOfMonth(today) };
    case "thisYear":
      return { start: startOfYear(today), end: `${today.slice(0, 4)}-12-31` };

    // "Last week" and "Last month" are the previous complete calendar period,
    // not a trailing 7 or 30 days - the trailing windows above already cover
    // that reading, so making these calendar periods is what distinguishes
    // them.
    case "lastWeek": {
      const start = addDays(startOfWeek(today), -7);
      return { start, end: addDays(start, 6) };
    }
    case "lastMonth": {
      const start = startOfMonth(addMonths(today, -1));
      return { start, end: endOfMonth(start) };
    }
    case "last3Months": {
      const start = startOfMonth(addMonths(today, -3));
      return { start, end: endOfMonth(addMonths(today, -1)) };
    }
    case "lastYear": {
      const year = Number(today.slice(0, 4)) - 1;
      return { start: `${year}-01-01`, end: `${year}-12-31` };
    }
    case "last2Years": {
      const year = Number(today.slice(0, 4));
      return { start: `${year - 2}-01-01`, end: `${year - 1}-12-31` };
    }

    case "thisWeekLastYear": {
      const start = startOfWeek(addYears(today, -1));
      return { start, end: addDays(start, 6) };
    }
    case "thisMonthLastYear": {
      const start = startOfMonth(addYears(today, -1));
      return { start, end: endOfMonth(start) };
    }

    case "nextWeek": {
      const start = addDays(startOfWeek(today), 7);
      return { start, end: addDays(start, 6) };
    }
    case "last28Next7":
      return forward(28, 7);
    case "last90Next21":
      return forward(90, 21);
    case "last180Next45":
      return forward(180, 45);

    case "inherit":
    default:
      // Callers resolve "inherit" against the page default before getting
      // here; reaching this case means one didn't, and the page fallback is a
      // better answer than an empty window.
      return back(28);
  }
}

/**
 * The range a widget actually draws: its own if it has one, otherwise the
 * page's, otherwise the built-in fallback for that page.
 */
export function effectiveDateRange(
  widget: WidgetDateRange | undefined,
  page: DashboardPage,
  pageRanges: PageDateRanges | undefined,
): WidgetDateRange {
  if (widget && widget.id !== "inherit") return widget;
  return { id: pageRanges?.[page] ?? PAGE_RANGE_FALLBACK[page] };
}

/** Keeps only the points inside the window; `series` order is preserved. */
export function filterSeriesToRange<T extends { date: string }>(series: T[], range: ResolvedRange): T[] {
  return series.filter((point) => point.date >= range.start && point.date <= range.end);
}
