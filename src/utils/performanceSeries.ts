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
  /**
   * True for days after today - where CTL/ATL/TSB are a projection, not a
   * record. Selecting a forward range used to widen the window onto a series
   * that stopped at today, so the extra days were simply blank; the chart can
   * now draw them, but it has to be able to tell them apart from what actually
   * happened.
   */
  projected?: boolean;
  /** True where TrainingPeaks supplied the figure rather than this file. */
  fromTrainingPeaks?: boolean;
};

/** A workout on the calendar that hasn't happened yet. */
export type PlannedTss = { date: string; tssPlanned?: number };

/** TrainingPeaks' own figures, which outrank anything computed here. */
export type TrainingPeaksInput = {
  fitness?: { date: string; ctl: number | null; atl: number | null; tsb: number | null }[];
  atp?: { weekStart: string; tssTarget: number | null; ctlTarget: number | null; tsbTarget: number | null }[];
};

// Same constants as computeFitnessSeries - repeated here because the forward
// projection has to continue TrainingPeaks' curve rather than this file's.
const CTL_DAYS = 42;
const ATL_DAYS = 7;

/**
 * How far past today the projection runs.
 *
 * Matches the longest forward-looking range on offer ("Last 180 and next 45
 * days"), so every preset has data to show. The widget's own range filter
 * trims it back from there - projecting further would be arithmetic nobody
 * can see.
 */
export const PROJECTION_DAYS = 45;

type RideLike = {
  startDate: string;
  movingTimeMinutes: number;
  avgWatts: number | null;
  weightedAvgWatts: number | null;
};

// Enough history behind the chart for the longest trailing range on offer
// that is worth plotting day-by-day. Was 120, which quietly truncated a
// "Last 365 days" selection to four months of line.
const DEFAULT_TRAILING_DAYS = 365;

function startOfWeek(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const weekday = d.getUTCDay();
  return addDays(dateStr, -(weekday === 0 ? 6 : weekday - 1));
}

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
  planned: PlannedTss[] = [],
  trainingPeaks?: TrainingPeaksInput,
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

  // Planned workouts carry the projection. Only future ones: a planned session
  // for a day that has already happened would be counted on top of the ride
  // that actually recorded it.
  const projectionEnd = addDays(today, PROJECTION_DAYS);
  for (const workout of planned) {
    if (workout.date <= today || workout.date > projectionEnd) continue;
    if (workout.tssPlanned == null) continue;
    dailyTssByDate.set(workout.date, (dailyTssByDate.get(workout.date) ?? 0) + workout.tssPlanned);
  }

  // Past days beyond a planned workout still get a point: with no TSS on the
  // calendar the EWMA simply decays, which is the honest projection of doing
  // nothing, and is what makes a rest week visibly bleed fitness.
  const series = computeFitnessSeries(dailyTssByDate, earliest, projectionEnd);

  // TrainingPeaks overrides everything computed above.
  //
  // This file builds CTL/ATL/TSB from Strava rides that recorded power, which
  // is a real subset of the athlete's training - it read 12 on a day
  // TrainingPeaks read 20. Where TrainingPeaks has a figure for a day, that is
  // the figure.
  const tpByDate = new Map((trainingPeaks?.fitness ?? []).map((p) => [p.date, p]));
  // The forward projection has to continue from TrainingPeaks' last real value,
  // not from this file's. Overlaying the past while leaving the projection on
  // the old curve would put a step in the line at today - so when TrainingPeaks
  // is present the future is re-run from its last actual reading, through the
  // same planned TSS.
  const lastTpActual = (trainingPeaks?.fitness ?? [])
    .filter((p) => p.date <= today && p.ctl != null && p.atl != null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1);

  const projectedFromTp = new Map<string, { ctl: number; atl: number; tsb: number }>();
  if (lastTpActual) {
    let ctl = lastTpActual.ctl as number;
    let atl = lastTpActual.atl as number;
    for (let date = addDays(lastTpActual.date, 1); date <= projectionEnd; date = addDays(date, 1)) {
      const tsb = Math.round((ctl - atl) * 10) / 10;
      const tss = dailyTssByDate.get(date) ?? 0;
      ctl += (tss - ctl) / CTL_DAYS;
      atl += (tss - atl) / ATL_DAYS;
      projectedFromTp.set(date, { ctl: Math.round(ctl * 10) / 10, atl: Math.round(atl * 10) / 10, tsb });
    }
  }

  // The real Annual Training Plan, when it has been read from TrainingPeaks,
  // rather than the copy hand-typed into atpPlan.ts.
  const tpAtpByWeek = new Map((trainingPeaks?.atp ?? []).map((w) => [w.weekStart, w]));
  const tpTargetsFor = (date: string) => {
    if (tpAtpByWeek.size === 0) return null;
    const monday = startOfWeek(date);
    return tpAtpByWeek.get(monday) ?? null;
  };

  const windowStart = addDays(today, -(trailingDays - 1));
  const points: PerformancePoint[] = [];
  for (const [date, point] of series) {
    if (date < windowStart) continue;
    const atpWeek = getAtpWeekFor(date);
    const tpWeek = tpTargetsFor(date);
    const tp = tpByDate.get(date);
    const tpProjected = projectedFromTp.get(date);
    const authoritative =
      date <= today
        ? tp && tp.ctl != null && tp.atl != null
          ? { ctl: tp.ctl, atl: tp.atl, tsb: tp.tsb ?? Math.round((tp.ctl - tp.atl) * 10) / 10 }
          : null
        : (tpProjected ?? null);

    points.push({
      date,
      tss: point.tss,
      ctl: authoritative?.ctl ?? point.ctl,
      atl: authoritative?.atl ?? point.atl,
      tsb: authoritative?.tsb ?? point.tsb,
      ctlTarget: tpWeek?.ctlTarget ?? atpWeek?.ctlTarget ?? null,
      tsbTarget: tpWeek?.tsbTarget ?? atpWeek?.tsbTarget ?? null,
      projected: date > today,
      fromTrainingPeaks: authoritative != null ? true : undefined,
    });
  }
  return points;
}
