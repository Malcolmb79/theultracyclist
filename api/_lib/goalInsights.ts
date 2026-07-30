/**
 * Server-side port of src/components/trends/goalInsights.ts and the pace maths
 * in GoalTrajectory.tsx.
 *
 * Ported rather than approximated: these figures appear side by side with the
 * dashboard's own card, and an image that says "-2.93kg/week" where the
 * dashboard says something else is worse than no image. Every definition below
 * matches its source - first-to-last over days actually spanned rather than an
 * average of readings, a 28-day window falling back to overall, a projection
 * only when the rate is actually closing the gap.
 */

const DAY = 86_400_000;

export type TrajectoryPoint = { date: string; value: number };
export type GoalInsight = { label: string; value: string; tone?: "good" | "bad" };
export type GoalDirection = "down" | "up";

function toMs(iso: string): number {
  return Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
}

function round(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * Change per week across a window.
 *
 * First-to-last over the days spanned, not an average of the readings:
 * weigh-ins are irregular, and a week with four readings would otherwise count
 * for more than a week with one.
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
  direction: GoalDirection,
  todayIso: string,
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

    const remaining = target - latest.value;
    const movingTowards = direction === "down" ? rate < 0 : rate > 0;
    if (movingTowards && Math.abs(rate) > 0.001) {
      const weeks = remaining / rate;
      const arrival = new Date(toMs(latest.date) + weeks * 7 * DAY);
      insights.push({
        label: "At this rate",
        value: arrival.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }),
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
    tone: daysSince > 7 ? "bad" : undefined,
  });

  insights.push({ label: "Readings", value: String(ordered.length) });
  return insights;
}

/**
 * Where the straight line from the first reading to the target sits today,
 * against where the reading actually is - the "ahead of pace" verdict.
 */
export function paceVerdict(
  points: TrajectoryPoint[],
  target: number,
  targetDate: string,
  direction: GoalDirection,
  todayIso: string,
): { ahead: boolean; deltaFromPace: number; paceToday: number } | null {
  if (points.length === 0) return null;
  const ordered = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const startDay = toMs(ordered[0].date);
  const endDay = toMs(targetDate);
  const span = endDay - startDay;
  if (span <= 0) return null;

  const progressed = Math.min(1, Math.max(0, (toMs(todayIso) - startDay) / span));
  const paceToday = ordered[0].value + (target - ordered[0].value) * progressed;
  const latest = ordered[ordered.length - 1].value;
  return {
    ahead: direction === "down" ? latest <= paceToday : latest >= paceToday,
    deltaFromPace: Math.abs(round(latest - paceToday)),
    paceToday,
  };
}
