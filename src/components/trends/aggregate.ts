import type { TrendMetricDef } from "./useTrendsData";
import type { TrendsViewType } from "./types";

// All range math works on plain "YYYY-MM-DD" strings (lexicographic
// comparison is safe for ISO dates) rather than Date object comparisons, to
// avoid local-timezone off-by-one-day bugs near midnight.
function startOfWeek(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

function endOfWeek(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + (6 - d.getUTCDay()));
  return d.toISOString().slice(0, 10);
}

export function datesInRange(days: string[], range: TrendsViewType, anchorDate: string): string[] {
  if (range === "day") return days.filter((d) => d === anchorDate);
  if (range === "week") {
    const start = startOfWeek(anchorDate);
    const end = endOfWeek(anchorDate);
    return days.filter((d) => d >= start && d <= end);
  }
  if (range === "month") {
    const monthKey = anchorDate.slice(0, 7);
    return days.filter((d) => d.slice(0, 7) === monthKey);
  }
  return days;
}

export function aggregateValue(metric: TrendMetricDef, days: string[], range: TrendsViewType, anchorDate: string): number | null {
  const values = datesInRange(days, range, anchorDate)
    .map((d) => metric.getValue(d))
    .filter((v): v is number => v != null);
  if (values.length === 0) return null;
  const total = values.reduce((a, b) => a + b, 0);
  const result = metric.aggregation === "sum" ? total : total / values.length;
  return Math.round(result * 100) / 100;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// Weight is a body-composition target, not a minimum to clear - "met" means
// close to goal either direction, within this tolerance.
const WEIGHT_TOLERANCE_KG = 0.5;

export function isGoalMet(metric: TrendMetricDef, value: number | null, goal: number | null): boolean | null {
  if (value == null || goal == null) return null;
  if (metric.goalDirection === "target") return Math.abs(value - goal) <= WEIGHT_TOLERANCE_KG;
  return value >= goal;
}
