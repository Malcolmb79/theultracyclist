import type { TrendMetricDef } from "./useTrendsData";
import type { TrendsViewType } from "./types";
import { irelandTodayDateStr } from "../../utils/irelandDate";

// All range math works on plain "YYYY-MM-DD" strings (lexicographic
// comparison is safe for ISO dates) rather than Date object comparisons, to
// avoid local-timezone off-by-one-day bugs near midnight.
// Weeks run Monday to Sunday, matching the "Mon-Sun" pill this backs and
// the startOfWeek every other part of the app already uses (atpPlan,
// coachSnapshot, timeContext, useCoachingData). Subtracting getUTCDay()
// raw would put the week boundary on Sunday, which showed last Sunday
// alongside this Mon/Tue/Wed - and on a Sunday would have collapsed the
// whole week view to that one day.
function daysSinceMonday(d: Date): number {
  const day = d.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  return day === 0 ? 6 : day - 1;
}

function startOfWeek(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - daysSinceMonday(d));
  return d.toISOString().slice(0, 10);
}

function endOfWeek(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + (6 - daysSinceMonday(d)));
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

// Ireland's calendar day, not UTC's. Irish local midnight is 23:00 UTC the
// previous day during BST, so a UTC "today" meant every Daily widget showed
// yesterday's numbers between midnight and 1am - and the weekly/monthly
// ranges anchored to it moved a day early too.
export function today(): string {
  return irelandTodayDateStr();
}

// Weight is a body-composition target, not a minimum to clear - "met" means
// close to goal either direction, within this tolerance. Default for any
// "target"-direction metric that doesn't set its own goalTolerance (CTL/TSB
// operate on a much larger numeric scale than weight, so they set theirs
// explicitly - see useTrendsData.ts).
const WEIGHT_TOLERANCE_KG = 0.5;

export function isGoalMet(metric: TrendMetricDef, value: number | null, goal: number | null): boolean | null {
  if (value == null || goal == null) return null;
  if (metric.goalDirection === "target") return Math.abs(value - goal) <= (metric.goalTolerance ?? WEIGHT_TOLERANCE_KG);
  return value >= goal;
}
