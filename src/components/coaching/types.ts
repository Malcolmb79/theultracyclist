import type { Widget } from "../dashboard/types";

export type TrainingPhase = "build" | "recovery" | "taper";

export type CoachingWidgetId = "readiness" | "chat" | "trainingPlan" | "powerZones";

export type CoachingWidgetRect = { x: number; y: number; width: number; height: number };

export type CoachingLayout = Partial<Record<CoachingWidgetId, CoachingWidgetRect>>;

export type CoachingSettings = {
  ftpWatts?: number;
  // Always centimeters regardless of the metric/imperial display toggle -
  // used only to derive the BMI widget (see src/utils/bmi.ts), which has no
  // meaningful imperial "unit" of its own to convert to.
  heightCm?: number;
  weeklyDistanceKm?: number;
  weeklyHours?: number;
  phase?: TrainingPhase;
  layout?: CoachingLayout;
  // Freely-added data-catalog widgets (the "hamburger" menu), same shape and
  // rendering (DashboardWidget) as Dashboard/Trends use - separate from the
  // 4 fixed coaching cards above, which keep their own `layout` slot.
  widgets?: Widget[];
  // Free-text standing instructions the athlete sets once, folded into
  // every coach prompt server-side - see api/coaching-settings.ts.
  customRules?: string;
};

export type ReadinessLevel = "hard" | "moderate" | "easy" | "rest";

export type Readiness = {
  level: ReadinessLevel;
  headline: string;
  reason: string;
  recoveryScore: number | null;
  recentAvgStrain: number | null;
};

export type PowerZone = {
  name: string;
  key: "recovery" | "endurance" | "tempo" | "threshold" | "vo2max" | "anaerobic" | "neuromuscular";
  minPercent: number;
  maxPercent: number | null;
  minWatts: number | null;
  maxWatts: number | null;
};

export type RideZoneClassification = {
  rideId: number;
  name: string;
  date: string;
  avgWatts: number;
  zone: PowerZone | null;
};

export type WeeklyProgress = {
  distanceKm: number;
  distanceTargetKm: number | null;
  hours: number;
  hoursTargetHours: number | null;
  rideCount: number;
};

// Mirrors NarrativeInput in api/coaching-narrative.ts - kept as an
// independent local type rather than a cross-directory import, matching how
// the rest of this project keeps the frontend and api/ TypeScript projects
// decoupled (see useDashboardData.ts's own local Whoop* types).
export type NarrativeInput = {
  recoveryScore: number | null;
  hrvMs: number | null;
  restingHeartRate: number | null;
  strainScore: number | null;
  recentAvgStrain: number | null;
  sleepPerformance: number | null;
  weeklyDistanceKm: number | null;
  weeklyTargetKm: number | null;
  phase: TrainingPhase | null;
  customRules: string | null;
  hasRiddenToday: boolean;
  todayDistanceKm: number | null;
};

export const PHASE_GUIDANCE: Record<TrainingPhase, { label: string; description: string }> = {
  build: {
    label: "Build",
    description:
      "Progressively increase weekly volume and include at least one longer ride and one higher-intensity session. Keep easy days genuinely easy.",
  },
  recovery: {
    label: "Recovery",
    description:
      "Cut weekly volume by roughly a third to a half compared to your build weeks. No hard intervals - aerobic spins only, and prioritize sleep.",
  },
  taper: {
    label: "Taper",
    description:
      "Sharp reduction in volume while keeping some intensity to stay sharp. Focus on being fresh, not fit - the fitness is already banked.",
  },
};
