import type { GarminDay } from "../../utils/garmin";
import type { Readiness } from "./types";

// The training plan's daily traffic light, on Garmin's own Training Readiness
// levels: green 75+, amber 50-74, red below 50.
const GREEN_READINESS = 75;
const AMBER_READINESS = 50;
// The plan's red flags beside the score itself: HRV down two days running, or
// resting HR 5+ bpm above the athlete's norm. A night under 7 hours makes the
// day amber at best.
const RHR_RISE_BPM = 5;
const SHORT_SLEEP_HOURS = 7;
// The resting-HR norm is the median of the previous few weeks, and needs a
// week of readings before it says anything.
const RHR_NORM_DAYS = 28;
const RHR_NORM_MIN_READINGS = 7;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** HRV lower on each of the last two mornings, ending on `date`. */
function hrvFallingTwoDays(days: GarminDay[], date: string): boolean {
  const withHrv = days.filter((d) => d.hrv != null && d.date <= date);
  const last = withHrv.slice(-3);
  if (last.length < 3 || last[2].date !== date) return false;
  return last[1].hrv! < last[0].hrv! && last[2].hrv! < last[1].hrv!;
}

/** How far `date`'s resting HR sits above the athlete's recent norm, in bpm. */
function restingHrRise(days: GarminDay[], date: string): number | null {
  const today = days.find((d) => d.date === date)?.restingHr;
  if (today == null) return null;
  const before = days.filter((d) => d.date < date && d.restingHr != null).slice(-RHR_NORM_DAYS);
  if (before.length < RHR_NORM_MIN_READINGS) return null;
  return today - median(before.map((d) => d.restingHr!));
}

// Deterministic, explainable rules - the plan's, not a black box.
export function computeReadiness(days: GarminDay[], today: string): Readiness {
  const latest = [...days].reverse().find((d) => d.readiness != null) ?? null;
  const readiness = latest?.readiness ?? null;
  const readinessDate = latest?.date ?? null;
  const day = readinessDate ? days.find((d) => d.date === readinessDate) : undefined;
  const base = {
    readiness,
    readinessDate,
    recoveryHours: day?.recoveryHours ?? null,
    sleepScore: day?.sleepScore ?? null,
  };

  if (readiness == null || readinessDate == null) {
    return {
      ...base,
      level: "moderate",
      headline: "No readiness yet",
      reason: "Garmin hasn't synced a Training Readiness reading yet - ride the bottom of each range until it does.",
    };
  }

  const stale = readinessDate !== today ? " (from an earlier day - today's hasn't synced yet)" : "";
  const hrvFalling = hrvFallingTwoDays(days, readinessDate);
  const rhrRise = restingHrRise(days, readinessDate);
  const rhrHigh = rhrRise != null && rhrRise >= RHR_RISE_BPM;
  const shortSleep = day?.sleepHours != null && day.sleepHours < SHORT_SLEEP_HOURS;

  const redFlags = [
    readiness < AMBER_READINESS ? `Training Readiness is ${readiness}${stale}` : null,
    hrvFalling ? "HRV has dropped two days running" : null,
    rhrHigh ? `resting HR is ${Math.round(rhrRise!)} bpm above your norm` : null,
  ].filter((flag): flag is string => flag != null);

  if (redFlags.length > 0) {
    const [first, ...rest] = redFlags;
    return {
      ...base,
      level: "rest",
      headline: "Red - 45 min Z1 or a day off",
      reason:
        `${first}${rest.length ? `, and ${rest.join(" and ")}` : ""}. Swap today's session for 45 minutes of ` +
        "Z1 or take the day off. Move the key session rather than doubling up.",
    };
  }

  if (readiness < GREEN_READINESS || shortSleep) {
    const why =
      readiness < GREEN_READINESS
        ? `Training Readiness is ${readiness}${stale}`
        : `Readiness is ${readiness}${stale}, but you slept ${day!.sleepHours!.toFixed(1)} hours`;
    return {
      ...base,
      level: "moderate",
      headline: "Amber - trim the session",
      reason: `${why}. Do the key session with one interval dropped, ride the bottom of each range, and skip Tuesday's optional block.`,
    };
  }

  return {
    ...base,
    level: "hard",
    headline: "Green - ride as planned",
    reason: `Training Readiness is ${readiness}${stale} - ride today's session as planned.`,
  };
}
