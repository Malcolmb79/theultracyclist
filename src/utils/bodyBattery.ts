import { irelandMinutesSinceMidnight } from "./irelandDate";

/**
 * Garmin's Body Battery, explained: the watch's own 0-100 reading, plus what
 * Garmin doesn't say - where the day is heading and what is left to spend.
 *
 * Deterministic and explainable, like readiness.ts - every term shows up as
 * its own line in the card, so the athlete can see *why* the number is what
 * it is rather than trusting a black box.
 */

/** Today's readings from the watch, as synced by scripts/garmin-sync.mjs. */
export interface GarminBatteryInputs {
  /** Latest body battery reading, 0-100. */
  current: number;
  /** Minutes after Irish midnight when `current` was read. */
  currentAtMinutes: number | null;
  /** The level at waking. */
  wake: number | null;
  charged: number | null;
  drained: number | null;
  sleepScore: number | null;
  hrv: number | null;
  restingHr: number | null;
  stress: number | null;
  readiness: number | null;
}

export type BodyBatteryBand = "high" | "medium" | "low";

export interface BodyBattery {
  /** Where the battery stands right now, 0-100. */
  level: number;
  /** What the athlete woke up with, 0-100. */
  startLevel: number;
  /** Where the battery lands at bedtime if the rest of the day is easy. */
  projectedEndLevel: number;
  /** What is left to spend before the reserve, in battery points and riding hours. */
  spare: { points: number; rideHours: number };
  band: BodyBatteryBand;
  headline: string;
  /** Each term, in the order they were applied. Positive charges, negative drains. */
  breakdown: BodyBatteryTerm[];
}

export interface BodyBatteryTerm {
  label: string;
  points: number;
  detail: string;
}

// Garmin's own Body Battery levels: high above 75, medium 51-75, low at 50 or
// below.
const HIGH_BAND = 76;
const LOW_BAND = 51;

// Just being awake costs about 24 points over a 16-hour day - the shape
// Garmin's own battery follows on a rest day (full in the morning, 60-70 by
// bedtime with no training).
const AWAKE_DRAIN_PER_HOUR = 1.5;
const AWAKE_HOURS = 16;

// The floor worth keeping in hand - a planned session that would push the
// battery below this is one the athlete should think twice about.
const RESERVE_LEVEL = 20;
// A steady endurance ride costs roughly this many Garmin battery points an
// hour. Only used to turn spare points into riding hours; tune against the
// watch's own drops during rides once enough history has synced.
const RIDE_POINTS_PER_HOUR = 12;
// A reading older than this is topped up with the awake drain since it was taken.
const STALE_READING_MINUTES = 20;
const MAX_STALE_MINUTES = 6 * 60;

function parseHHMM(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function bodyBatteryBand(level: number): BodyBatteryBand {
  if (level >= HIGH_BAND) return "high";
  if (level >= LOW_BAND) return "medium";
  return "low";
}

function headlineFor(band: BodyBatteryBand): string {
  return band === "high" ? "Well charged" : band === "medium" ? "Steady" : "Running low";
}

/**
 * @param wakeTime "HH:MM" - when the day's awake drain starts, used for the
 *   bedtime projection.
 */
export function computeBodyBattery(garmin: GarminBatteryInputs, wakeTime: string, now: Date = new Date()): BodyBattery {
  const breakdown: BodyBatteryTerm[] = [];
  const nowMinutes = irelandMinutesSinceMidnight(now);

  const start = clamp(Math.round(garmin.wake ?? garmin.current), 0, 100);
  const wakeDetail = [
    garmin.sleepScore != null ? `Sleep ${Math.round(garmin.sleepScore)}` : null,
    garmin.hrv != null ? `HRV ${Math.round(garmin.hrv)} ms` : null,
    garmin.restingHr != null ? `resting HR ${Math.round(garmin.restingHr)}` : null,
    garmin.readiness != null ? `readiness ${Math.round(garmin.readiness)}` : null,
  ].filter((part): part is string => part != null);
  breakdown.push({
    label: "Woke with",
    points: start,
    detail: wakeDetail.length > 0 ? wakeDetail.join(", ") : "From your watch",
  });

  let level = clamp(Math.round(garmin.current), 0, 100);
  const change = level - start;
  if (change !== 0) {
    const parts = [
      garmin.drained != null ? `drained ${Math.round(garmin.drained)}` : null,
      garmin.charged != null ? `charged ${Math.round(garmin.charged)}` : null,
      garmin.stress != null ? `avg stress ${Math.round(garmin.stress)}` : null,
    ].filter((part): part is string => part != null);
    breakdown.push({
      label: change < 0 ? "Used so far" : "Recharged",
      points: change,
      detail: parts.length > 0 ? `Garmin: ${parts.join(", ")}` : "Change since waking",
    });
  }

  // The watch only reports when the phone syncs, so a stale reading is topped
  // up with the awake drain since it was taken rather than shown as current.
  const age = garmin.currentAtMinutes != null ? nowMinutes - garmin.currentAtMinutes : 0;
  if (age > STALE_READING_MINUTES) {
    const catchUp = Math.round((Math.min(age, MAX_STALE_MINUTES) / 60) * AWAKE_DRAIN_PER_HOUR);
    if (catchUp > 0) {
      level = clamp(level - catchUp, 0, 100);
      breakdown.push({ label: "Since last sync", points: -catchUp, detail: `Watch last synced ${Math.round(age)} min ago - estimate` });
    }
  }

  const wakeMinutes = parseHHMM(wakeTime) ?? 7 * 60;
  const awakeHours = clamp((nowMinutes - wakeMinutes) / 60, 0, AWAKE_HOURS);
  const remainingAwakeDrain = Math.round((AWAKE_HOURS - awakeHours) * AWAKE_DRAIN_PER_HOUR);
  const projectedEndLevel = clamp(level - remainingAwakeDrain, 0, 100);
  const spare = Math.max(0, projectedEndLevel - RESERVE_LEVEL);
  const band = bodyBatteryBand(level);

  return {
    level,
    startLevel: start,
    projectedEndLevel,
    spare: { points: spare, rideHours: Math.round((spare / RIDE_POINTS_PER_HOUR) * 10) / 10 },
    band,
    headline: headlineFor(band),
    breakdown,
  };
}
