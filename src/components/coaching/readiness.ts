import type { Readiness } from "./types";

// Garmin's own Training Readiness levels: High 75+, Moderate 50-74, Low 25-49,
// Poor below.
const HIGH_READINESS = 75;
const MODERATE_READINESS = 50;
const LOW_READINESS = 25;
// Garmin's recovery time is how long it still advises before the next hard
// effort; a day or more left means today isn't the day for one, whatever the
// morning's score says.
const LONG_RECOVERY_HOURS = 24;

export type ReadinessInputs = {
  readiness: number | null;
  readinessDate: string | null;
  recoveryHours: number | null;
  sleepScore: number | null;
  today: string;
};

// Deterministic, explainable rules - not a black box. Training Readiness
// already folds in sleep, HRV, recovery time and load balance; recovery time
// is checked separately so a high score straight after a big session still
// gets tempered advice rather than a blanket "go hard".
export function computeReadiness({ readiness, readinessDate, recoveryHours, sleepScore, today }: ReadinessInputs): Readiness {
  const base = { readiness, readinessDate, recoveryHours, sleepScore };
  if (readiness == null) {
    return {
      ...base,
      level: "moderate",
      headline: "No readiness yet",
      reason: "Garmin hasn't synced a Training Readiness reading yet - defaulting to a moderate, aerobic day.",
    };
  }

  const stale = readinessDate !== today ? " (from an earlier day - today's hasn't synced yet)" : "";
  const longRecovery = recoveryHours != null && recoveryHours >= LONG_RECOVERY_HOURS;

  if (readiness >= HIGH_READINESS && !longRecovery) {
    return {
      ...base,
      level: "hard",
      headline: "Hard day",
      reason: `Training Readiness is high at ${readiness}${stale} - a good day for a quality or high-intensity session.`,
    };
  }

  if (readiness >= HIGH_READINESS) {
    return {
      ...base,
      level: "moderate",
      headline: "Moderate day",
      reason: `Training Readiness is high at ${readiness}${stale}, but Garmin still advises ${Math.round(recoveryHours ?? 0)} hours of recovery - keep today aerobic rather than adding hard work on top.`,
    };
  }

  if (readiness >= MODERATE_READINESS) {
    return {
      ...base,
      level: "moderate",
      headline: "Moderate day",
      reason: `Training Readiness is moderate at ${readiness}${stale} - steady aerobic work today, and save hard efforts for a higher-readiness day.`,
    };
  }

  if (readiness >= LOW_READINESS) {
    return {
      ...base,
      level: "easy",
      headline: "Easy day",
      reason: `Training Readiness is low at ${readiness}${stale} - keep it to an easy spin, or rest.`,
    };
  }

  return {
    ...base,
    level: "rest",
    headline: "Rest day",
    reason: `Training Readiness is poor at ${readiness}${stale} - prioritise rest and sleep today.`,
  };
}
