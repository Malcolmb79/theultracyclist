import { irelandMinutesSinceMidnight } from "./irelandDate";

/**
 * A Garmin-style "body battery": one 0-100 number for how much energy the
 * athlete has right now, and where it is heading.
 *
 * Deterministic and explainable, like readiness.ts - every term below shows
 * up as its own line in the card, so the athlete can see *why* the number is
 * what it is rather than trusting a black box. Whoop's recovery score is the
 * morning charge (it already folds in HRV, resting heart rate and sleep),
 * sleep performance tempers it, recent training load carries over, and then
 * the day drains it: slowly just from being awake, faster for training
 * (today's Whoop strain, or Apple Health active energy when strain hasn't
 * synced), with a small penalty for riding under-fuelled.
 */

/**
 * Today's readings from the watch, as synced by scripts/garmin-sync.mjs.
 * Garmin already folds sleep, HRV, stress and activity into its own battery,
 * so when it is present the number shown is Garmin's - this model only adds
 * what Garmin doesn't say: where the day is heading and what is left to spend.
 */
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

export interface BodyBatteryInputs {
  /** Garmin's own reading for today; replaces the Whoop-based estimate when present. */
  garmin?: GarminBatteryInputs | null;
  /** Whoop recovery score for today's cycle, 0-100. */
  recoveryScore: number | null;
  /** Whoop sleep performance for today's cycle, 0-100. */
  sleepPerformance: number | null;
  /** Today's strain so far, 0-21. Whoop scores it live through the day. */
  todayStrain: number | null;
  /** Yesterday's final strain, 0-21 - a hard day carries into the next. */
  yesterdayStrain: number | null;
  /** Mean strain over the last three complete days. */
  recentAvgStrain: number | null;
  /** Apple Health Active Energy for today, kcal - training fallback. */
  activeKcalToday: number | null;
  /** Apple Health Dietary Energy for today, kcal. */
  consumedKcalToday: number | null;
  /** Estimated or measured total burn so far today, kcal. */
  burnedKcalToday: number | null;
  /** "HH:MM" - when the day's drain starts. */
  wakeTime: string;
}

export type BodyBatteryBand = "high" | "medium" | "low";

export interface BodyBattery {
  /** Where the battery stands right now, 0-100. */
  level: number;
  /** What the athlete woke up with, 0-100. */
  startLevel: number;
  /** Where the battery lands at bedtime if the rest of the day is easy. */
  projectedEndLevel: number;
  /**
   * How much Whoop strain the athlete could still add today and finish above
   * the reserve. Null when the level comes from Garmin, which has no strain.
   */
  strainBudget: number | null;
  /** What is left to spend before the reserve, in battery points and riding hours. */
  spare: { points: number; rideHours: number };
  /** Where the level came from. */
  source: "garmin" | "whoop" | "estimate";
  band: BodyBatteryBand;
  headline: string;
  /** Each term, in the order they were applied. Positive charges, negative drains. */
  breakdown: BodyBatteryTerm[];
  /** True when there was no recovery score to start from. */
  estimatedStart: boolean;
}

export interface BodyBatteryTerm {
  label: string;
  points: number;
  detail: string;
}

// Whoop's own green/amber/red recovery thresholds, so the battery's colour
// agrees with the recovery ring beside it on the same number.
const HIGH_BAND = 67;
const LOW_BAND = 34;

// Morning charge: recovery carries most of the weight because it already
// contains the overnight HRV/RHR/sleep picture; sleep performance is added
// on its own because a great HRV night on four hours of sleep still leaves
// the athlete flat by mid-afternoon. The blend is then mapped onto 30-100
// rather than used raw: Whoop's 50% is an ordinary "yellow" morning, not a
// half-empty one, and reading it as 50 points had a normal ride emptying
// the battery by mid-afternoon.
const RECOVERY_WEIGHT = 0.7;
const SLEEP_WEIGHT = 0.3;
const START_FLOOR = 30;
const START_RANGE = 0.7;
const FALLBACK_START = 70;
// Below this the previous day's strain starts eating into the next morning.
const CARRYOVER_STRAIN = 14;
const CARRYOVER_POINTS_PER_STRAIN = 2;
const MAX_CARRYOVER_POINTS = 10;
// Same bar readiness.ts uses for "recent load has been high".
const HIGH_RECENT_STRAIN = 12;
const RECENT_LOAD_POINTS = 5;
const MIN_START = 5;

// Just being awake costs about 24 points over a 16-hour day - the shape
// Garmin's own battery follows on a rest day (full in the morning, 60-70 by
// bedtime with no training).
const AWAKE_DRAIN_PER_HOUR = 1.5;
const AWAKE_HOURS = 16;

// Whoop strain is logarithmic (21 is an all-out day), so the drain curve
// bends the other way: a strain-10 morning spin costs ~13 points, strain 15
// ~26, and a strain-21 day takes 45 points on its own.
const MAX_STRAIN = 21;
const MAX_TRAINING_DRAIN = 45;
const STRAIN_CURVE = 1.6;
// Active energy fallback when today's strain hasn't synced yet: ~1,500 kcal
// of activity is a very big day and worth the full training drain.
const KCAL_PER_POINT = 33;

// Riding on an empty tank: after lunch, having eaten under 60% of what has
// been burned so far shaves a few points, up to eight.
const FUEL_CHECK_AFTER_MINUTES = 13 * 60;
const FUEL_RATIO_FLOOR = 0.6;
const FUEL_POINTS_PER_RATIO = 20;
const MAX_FUEL_PENALTY = 8;

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

export function trainingDrainForStrain(strain: number): number {
  const fraction = clamp(strain, 0, MAX_STRAIN) / MAX_STRAIN;
  return Math.round(Math.pow(fraction, STRAIN_CURVE) * MAX_TRAINING_DRAIN);
}

/** Inverse of trainingDrainForStrain - the strain that would cost `points`. */
export function strainForTrainingDrain(points: number): number {
  const fraction = clamp(points, 0, MAX_TRAINING_DRAIN) / MAX_TRAINING_DRAIN;
  return Math.round(Math.pow(fraction, 1 / STRAIN_CURVE) * MAX_STRAIN * 10) / 10;
}

export function bodyBatteryBand(level: number): BodyBatteryBand {
  if (level >= HIGH_BAND) return "high";
  if (level >= LOW_BAND) return "medium";
  return "low";
}

function sparePoints(projectedEndLevel: number): BodyBattery["spare"] {
  const points = Math.max(0, projectedEndLevel - RESERVE_LEVEL);
  return { points, rideHours: Math.round((points / RIDE_POINTS_PER_HOUR) * 10) / 10 };
}

function headlineFor(band: BodyBatteryBand): string {
  return band === "high" ? "Well charged" : band === "medium" ? "Steady" : "Running low";
}

function computeFromGarmin(garmin: GarminBatteryInputs, inputs: BodyBatteryInputs, now: Date): BodyBattery {
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

  const wakeMinutes = parseHHMM(inputs.wakeTime) ?? 7 * 60;
  const awakeHours = clamp((nowMinutes - wakeMinutes) / 60, 0, AWAKE_HOURS);
  const remainingAwakeDrain = Math.round((AWAKE_HOURS - awakeHours) * AWAKE_DRAIN_PER_HOUR);
  const projectedEndLevel = clamp(level - remainingAwakeDrain, 0, 100);
  const band = bodyBatteryBand(level);

  return {
    level,
    startLevel: start,
    projectedEndLevel,
    strainBudget: null,
    spare: sparePoints(projectedEndLevel),
    source: "garmin",
    band,
    headline: headlineFor(band),
    breakdown,
    estimatedStart: false,
  };
}

export function computeBodyBattery(inputs: BodyBatteryInputs, now: Date = new Date()): BodyBattery {
  if (inputs.garmin) return computeFromGarmin(inputs.garmin, inputs, now);

  const breakdown: BodyBatteryTerm[] = [];

  // Morning charge.
  const estimatedStart = inputs.recoveryScore == null;
  let start: number;
  if (inputs.recoveryScore == null) {
    start = FALLBACK_START;
    breakdown.push({ label: "Woke with", points: start, detail: "No recovery score yet - assuming an average night" });
  } else {
    const blended =
      inputs.sleepPerformance == null
        ? inputs.recoveryScore
        : RECOVERY_WEIGHT * inputs.recoveryScore + SLEEP_WEIGHT * inputs.sleepPerformance;
    start = Math.round(START_FLOOR + START_RANGE * blended);
    breakdown.push({
      label: "Woke with",
      points: start,
      detail:
        inputs.sleepPerformance == null
          ? `Recovery ${inputs.recoveryScore}%`
          : `Recovery ${inputs.recoveryScore}%, sleep ${inputs.sleepPerformance}%`,
    });
  }

  if (inputs.yesterdayStrain != null && inputs.yesterdayStrain > CARRYOVER_STRAIN) {
    const carry = Math.min(MAX_CARRYOVER_POINTS, Math.round((inputs.yesterdayStrain - CARRYOVER_STRAIN) * CARRYOVER_POINTS_PER_STRAIN));
    if (carry > 0) {
      start -= carry;
      breakdown.push({ label: "Yesterday's effort", points: -carry, detail: `Strain ${inputs.yesterdayStrain.toFixed(1)} still in the legs` });
    }
  }

  if (inputs.recentAvgStrain != null && inputs.recentAvgStrain >= HIGH_RECENT_STRAIN) {
    start -= RECENT_LOAD_POINTS;
    breakdown.push({ label: "Recent load", points: -RECENT_LOAD_POINTS, detail: `Avg strain ${inputs.recentAvgStrain.toFixed(1)} over 3 days` });
  }

  start = clamp(Math.round(start), MIN_START, 100);

  // Hours awake so far, and left until bedtime.
  const wakeMinutes = parseHHMM(inputs.wakeTime) ?? 7 * 60;
  const nowMinutes = irelandMinutesSinceMidnight(now);
  const awakeHours = clamp((nowMinutes - wakeMinutes) / 60, 0, AWAKE_HOURS);
  const remainingHours = AWAKE_HOURS - awakeHours;

  let level = start;
  const awakeDrain = Math.round(awakeHours * AWAKE_DRAIN_PER_HOUR);
  if (awakeDrain > 0) {
    level -= awakeDrain;
    breakdown.push({ label: "Awake", points: -awakeDrain, detail: `${awakeHours.toFixed(1)} h since ${inputs.wakeTime}` });
  }

  // Training so far today.
  if (inputs.todayStrain != null && inputs.todayStrain > 0) {
    const drain = trainingDrainForStrain(inputs.todayStrain);
    level -= drain;
    breakdown.push({ label: "Training", points: -drain, detail: `Strain ${inputs.todayStrain.toFixed(1)} so far` });
  } else if (inputs.activeKcalToday != null && inputs.activeKcalToday > 0) {
    const drain = Math.min(MAX_TRAINING_DRAIN, Math.round(inputs.activeKcalToday / KCAL_PER_POINT));
    level -= drain;
    breakdown.push({
      label: "Training",
      points: -drain,
      detail: `${Math.round(inputs.activeKcalToday).toLocaleString("en-GB")} kcal active energy (no strain synced yet)`,
    });
  }

  // Fuelling.
  if (
    nowMinutes >= FUEL_CHECK_AFTER_MINUTES &&
    inputs.consumedKcalToday != null &&
    inputs.burnedKcalToday != null &&
    inputs.burnedKcalToday > 0
  ) {
    const ratio = inputs.consumedKcalToday / inputs.burnedKcalToday;
    const penalty = Math.round(clamp((FUEL_RATIO_FLOOR - ratio) * FUEL_POINTS_PER_RATIO, 0, MAX_FUEL_PENALTY));
    if (penalty > 0) {
      level -= penalty;
      breakdown.push({
        label: "Under-fuelled",
        points: -penalty,
        detail: `Eaten ${Math.round(ratio * 100)}% of what you've burned`,
      });
    }
  }

  level = clamp(Math.round(level), 0, 100);

  const remainingAwakeDrain = Math.round(remainingHours * AWAKE_DRAIN_PER_HOUR);
  const projectedEndLevel = clamp(level - remainingAwakeDrain, 0, 100);
  const strainBudget = strainForTrainingDrain(Math.max(0, projectedEndLevel - RESERVE_LEVEL));

  const band = bodyBatteryBand(level);

  return {
    level,
    startLevel: start,
    projectedEndLevel,
    strainBudget,
    spare: sparePoints(projectedEndLevel),
    source: estimatedStart ? "estimate" : "whoop",
    band,
    headline: headlineFor(band),
    breakdown,
    estimatedStart,
  };
}
