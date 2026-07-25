import type { Readiness } from "./types";

const HIGH_RECOVERY = 67; // matches Whoop's own green banding threshold
const LOW_RECOVERY = 34; // matches Whoop's own red banding threshold
const HIGH_RECENT_STRAIN = 12; // Whoop's own "moderate" strain examples run ~8.7-12.7

// Deterministic, explainable rules - not a black box. Combines today's
// recovery with recent training load (not just recovery alone) so a
// high-recovery day right after several hard days still gets tempered
// advice rather than a blanket "go hard".
export function computeReadiness(recoveryScore: number | null, recentAvgStrain: number | null): Readiness {
  if (recoveryScore == null) {
    return {
      level: "moderate",
      headline: "No recovery data yet",
      reason: "Add a Whoop recovery reading to get a real recommendation - defaulting to a moderate, aerobic day.",
      recoveryScore,
      recentAvgStrain,
    };
  }

  const highRecentLoad = recentAvgStrain != null && recentAvgStrain >= HIGH_RECENT_STRAIN;

  if (recoveryScore >= HIGH_RECOVERY && !highRecentLoad) {
    return {
      level: "hard",
      headline: "Hard day",
      reason: `Recovery is strong at ${recoveryScore}% and recent load has been manageable - good day for a quality or high-intensity session.`,
      recoveryScore,
      recentAvgStrain,
    };
  }

  if (recoveryScore >= HIGH_RECOVERY && highRecentLoad) {
    return {
      level: "moderate",
      headline: "Moderate day",
      reason: `Recovery is strong at ${recoveryScore}%, but recent strain has been high (avg ${recentAvgStrain?.toFixed(1)} over the last 3 days) - keep today aerobic rather than adding more load on top.`,
      recoveryScore,
      recentAvgStrain,
    };
  }

  if (recoveryScore >= LOW_RECOVERY) {
    return {
      level: "moderate",
      headline: "Moderate day",
      reason: `Recovery is middling at ${recoveryScore}% - steady aerobic work today, save hard efforts for a better recovery day.`,
      recoveryScore,
      recentAvgStrain,
    };
  }

  return {
    level: "rest",
    headline: "Rest or easy day",
    reason: `Recovery is low at ${recoveryScore}% - prioritize rest, or keep it to a genuinely easy spin if you ride at all.`,
    recoveryScore,
    recentAvgStrain,
  };
}
