import { computeTss } from "./tss";
import { computeFitnessSeries } from "./fitness";
import { getAtpWeekFor } from "./atpPlan";
import { irelandDateStr } from "./irelandDate";

export type PerformancePoint = {
  date: string;
  tss: number;
  ctl: number;
  atl: number;
  tsb: number;
  ctlTarget: number | null;
  tsbTarget: number | null;
};

type RideLike = {
  startDate: string;
  movingTimeMinutes: number;
  avgWatts: number | null;
  weightedAvgWatts: number | null;
};

const DEFAULT_TRAILING_DAYS = 120;

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Shared by Dashboard's useDashboardData.ts and Trends' useTrendsData.ts so
// the "Performance Management Chart" widget shows identical numbers on both
// pages - computes the full CTL/ATL/TSB history from all available ride
// data (fitness depends on everything before the display window, not just
// what's shown), then returns only the trailing `trailingDays` merged with
// that week's ATP target from atpPlan.ts, so the widget itself never has to
// touch raw ride data or know about the 42/7-day EWMA math.
export function computePerformanceSeries(
  rides: RideLike[],
  ftpWatts: number | undefined,
  today: string,
  trailingDays = DEFAULT_TRAILING_DAYS,
): PerformancePoint[] {
  const dailyTssByDate = new Map<string, number>();
  let earliest: string | null = null;
  for (const r of rides) {
    // startDate is Strava's UTC start_date, so the ride's Irish calendar day
    // has to be derived rather than sliced off the front - an 00:30 BST start
    // is 23:30 UTC the day before, which put its whole TSS on the wrong day.
    const date = irelandDateStr(new Date(r.startDate));
    const tss = computeTss(r.weightedAvgWatts ?? r.avgWatts, r.movingTimeMinutes, ftpWatts) ?? 0;
    dailyTssByDate.set(date, (dailyTssByDate.get(date) ?? 0) + tss);
    if (!earliest || date < earliest) earliest = date;
  }
  if (!earliest) return [];

  const series = computeFitnessSeries(dailyTssByDate, earliest, today);
  const windowStart = addDays(today, -(trailingDays - 1));
  const points: PerformancePoint[] = [];
  for (const [date, point] of series) {
    if (date < windowStart) continue;
    const atpWeek = getAtpWeekFor(date);
    points.push({
      date,
      tss: point.tss,
      ctl: point.ctl,
      atl: point.atl,
      tsb: point.tsb,
      ctlTarget: atpWeek?.ctlTarget ?? null,
      tsbTarget: atpWeek?.tsbTarget ?? null,
    });
  }
  return points;
}
