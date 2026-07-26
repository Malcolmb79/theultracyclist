export type TrainingPhase = "build" | "recovery" | "taper";

// The built-in cards render fixed custom components rather than a metric
// series - "metric" is everything added from the data catalog instead. A
// single flat list of this shape (rather than the old split between a
// `layout` record for the fixed cards and a separate `widgets` array for
// metrics) is what lets add/remove/resize/move/reorder work identically
// across every widget on the Coaching page, matching Dashboard/Trends.
export type FixedCardKind = "readiness" | "chat" | "trainingPlan" | "powerZones" | "trainingCalendar";

export type CoachingWidgetEntry = {
  id: string; // fixed cards use their own kind as the id (only one of each can exist); metrics get a generated id.
  kind: FixedCardKind | "metric";
  // Only set when kind === "metric":
  source?: "strava" | "whoop" | "health" | "weather" | "garmin";
  metric?: string;
  viewType?: "stat" | "chart" | "timeline" | "ring" | "combo" | "rings" | "healthCalendar" | "caloriesBalance";
  label: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  color?: string;
};

export const FIXED_CARD_LABELS: Record<FixedCardKind, string> = {
  readiness: "Today's Readiness",
  chat: "AI Coach",
  trainingPlan: "Training Plan",
  powerZones: "Power Zones",
  trainingCalendar: "Training Calendar",
};

export type CoachingSettings = {
  ftpWatts?: number;
  // Always centimeters regardless of the metric/imperial display toggle -
  // used only to derive the BMI widget (see src/utils/bmi.ts), which has no
  // meaningful imperial "unit" of its own to convert to.
  heightCm?: number;
  weeklyDistanceKm?: number;
  weeklyHours?: number;
  phase?: TrainingPhase;
  widgets?: CoachingWidgetEntry[];
  // Free-text standing instructions the athlete sets once, folded into
  // every coach prompt server-side - see api/coaching-settings.ts.
  customRules?: string;
  // A small square JPEG data URL, already resized client-side (see
  // src/utils/resizeImage.ts) before being saved - shown in ProfileMenu.
  profilePictureDataUrl?: string;
  // Pasted manually before a ride/the attempt - Garmin generates a new
  // LiveTrack session URL each time one is started, no persistent
  // connection to store. Embedded directly as an iframe src by
  // GarminLiveTrackCard.tsx rather than parsed/fetched server-side - see
  // that component for why.
  garminLiveTrackUrl?: string;
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
      "Cut weekly volume by roughly a third to a half compared to your build weeks. No hard intervals - aerobic spins only, and prioritise sleep.",
  },
  taper: {
    label: "Taper",
    description:
      "Sharp reduction in volume while keeping some intensity to stay sharp. Focus on being fresh, not fit - the fitness is already banked.",
  },
};
