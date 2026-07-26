export type FitnessPoint = { date: string; tss: number; ctl: number; atl: number; tsb: number };

// Standard Coggan/TrainingPeaks definitions: CTL ("fitness") and ATL
// ("fatigue") are 42-day and 7-day exponentially-weighted moving averages
// of daily TSS; TSB ("form") is CTL minus ATL, computed from the PREVIOUS
// day's values - today's own training hasn't affected today's form yet,
// it's what you're carrying into today. Both averages start at 0, so the
// first several weeks of whatever date range is passed in under-report
// true fitness if there was real training before that range starts - the
// same ramp-up artifact TrainingPeaks itself shows when a data import
// starts from a hard cutoff date, not a bug specific to this calculation.
// Mirrors api/_lib/fitness.ts - see tss.ts for why this is duplicated
// rather than shared across the frontend/api boundary.
const CTL_DAYS = 42;
const ATL_DAYS = 7;

function nextDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function computeFitnessSeries(
  dailyTssByDate: Map<string, number>,
  startDate: string,
  endDate: string,
): Map<string, FitnessPoint> {
  const result = new Map<string, FitnessPoint>();
  let ctl = 0;
  let atl = 0;
  for (let date = startDate; date <= endDate; date = nextDay(date)) {
    const tsb = Math.round((ctl - atl) * 10) / 10; // form going into today, before today's training
    const tss = dailyTssByDate.get(date) ?? 0;
    ctl += (tss - ctl) / CTL_DAYS;
    atl += (tss - atl) / ATL_DAYS;
    result.set(date, { date, tss, ctl: Math.round(ctl * 10) / 10, atl: Math.round(atl * 10) / 10, tsb });
  }
  return result;
}
