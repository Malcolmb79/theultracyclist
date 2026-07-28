import type { TrajectoryPoint } from "./GoalTrajectory";

/**
 * What the readings say beyond the headline figures.
 *
 * The chart shows the shape and the summary shows the gap; neither answers
 * the questions that follow from them — how fast this is actually moving, and
 * where that rate lands. Those are arithmetic on the same readings, so they
 * belong beside the chart rather than in a person's head.
 */

export interface GoalInsight {
  label: string;
  value: string;
  /** Set where the figure is good or bad news rather than neutral. */
  tone?: "good" | "bad";
}

const DAY = 86_400_000;

function toMs(iso: string): number {
  return Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
}

function round(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * Change per week across a window, from the readings inside it.
 *
 * Measured first-to-last over the days actually spanned rather than as an
 * average of the readings: weigh-ins are irregular, and a week with four
 * readings would otherwise count for more than a week with one.
 */
export function ratePerWeek(points: TrajectoryPoint[], windowDays?: number): number | null {
  if (points.length < 2) return null;
  const ordered = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const latest = ordered[ordered.length - 1];
  const cutoff = windowDays == null ? -Infinity : toMs(latest.date) - windowDays * DAY;
  const window = ordered.filter((p) => toMs(p.date) >= cutoff);
  if (window.length < 2) return null;

  const first = window[0];
  const days = (toMs(latest.date) - toMs(first.date)) / DAY;
  if (days <= 0) return null;
  return ((latest.value - first.value) / days) * 7;
}

export function goalInsights(
  points: TrajectoryPoint[],
  target: number,
  unit: string,
  direction: "down" | "up",
  todayIso: string
): GoalInsight[] {
  if (points.length === 0) return [];

  const ordered = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const first = ordered[0];
  const latest = ordered[ordered.length - 1];
  const insights: GoalInsight[] = [];

  const moved = latest.value - first.value;
  const towardGoal = direction === "down" ? moved < 0 : moved > 0;
  insights.push({
    label: "Since you started",
    value: `${moved > 0 ? "+" : ""}${round(moved)}${unit}`,
    tone: moved === 0 ? undefined : towardGoal ? "good" : "bad",
  });

  const recent = ratePerWeek(ordered, 28);
  const overall = ratePerWeek(ordered);
  const rate = recent ?? overall;

  if (rate != null) {
    const rateGood = direction === "down" ? rate < 0 : rate > 0;
    insights.push({
      label: recent != null ? "Rate (last 4 weeks)" : "Rate",
      value: `${rate > 0 ? "+" : ""}${round(rate, 2)}${unit}/week`,
      tone: rate === 0 ? undefined : rateGood ? "good" : "bad",
    });

    // Where this rate lands, which is the question a rate raises. Only
    // meaningful when it is moving the right way at all — projecting a date
    // from a rate heading away from the target would print a date in the
    // past or a century out.
    const remaining = target - latest.value;
    const movingTowards = direction === "down" ? rate < 0 : rate > 0;
    if (movingTowards && Math.abs(rate) > 0.001) {
      const weeks = remaining / rate;
      const arrival = new Date(toMs(latest.date) + weeks * 7 * DAY);
      insights.push({
        label: "At this rate",
        value: arrival.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }),
      });
    } else {
      insights.push({ label: "At this rate", value: "not closing the gap", tone: "bad" });
    }
  }

  const best = direction === "down" ? Math.min(...ordered.map((p) => p.value)) : Math.max(...ordered.map((p) => p.value));
  insights.push({ label: direction === "down" ? "Lowest" : "Highest", value: `${round(best)}${unit}` });

  const daysSince = Math.round((toMs(todayIso) - toMs(latest.date)) / DAY);
  insights.push({
    label: "Last reading",
    value: daysSince <= 0 ? "today" : daysSince === 1 ? "yesterday" : `${daysSince} days ago`,
    // A goal being tracked on a stale reading is worth flagging: the chart
    // looks equally confident either way.
    tone: daysSince > 7 ? "bad" : undefined,
  });

  insights.push({ label: "Readings", value: String(ordered.length) });

  return insights;
}
