// Garmin readings arrive through the health history as flat garmin_* fields
// (see scripts/garmin-sync.mjs); this regroups them into one record per day.

type HealthHistory = Record<string, Record<string, { value: number }>>;

export type GarminReadinessFactors = {
  sleep: number | null;
  recovery: number | null;
  hrv: number | null;
  load: number | null;
  stress: number | null;
  sleepHistory: number | null;
};

export type GarminDay = {
  /** Irish calendar day, YYYY-MM-DD. */
  date: string;
  readiness: number | null;
  factors: GarminReadinessFactors;
  recoveryHours: number | null;
  sleepScore: number | null;
  sleepHours: number | null;
  sleepNeedHours: number | null;
  deepHours: number | null;
  lightHours: number | null;
  remHours: number | null;
  awakeHours: number | null;
  awakenings: number | null;
  sleepStress: number | null;
  respiration: number | null;
  sleepBatteryGain: number | null;
  hrv: number | null;
  hrvWeekly: number | null;
  hrvStatus: number | null;
  restingHr: number | null;
  stress: number | null;
  steps: number | null;
  /** Sum of the day's activity training loads; 0 on a day with readings but no activity. */
  trainingLoad: number | null;
  acuteLoad: number | null;
  activityMinutes: number | null;
  bodyBattery: number | null;
  bodyBatteryWake: number | null;
  bodyBatteryHigh: number | null;
  bodyBatteryLow: number | null;
  charged: number | null;
  drained: number | null;
};

/** Chronological, oldest first, days with at least one Garmin reading only. */
export function garminDaysFrom(history: HealthHistory): GarminDay[] {
  const days: GarminDay[] = [];
  for (const date of Object.keys(history).sort()) {
    const fields = history[date];
    if (!Object.keys(fields).some((name) => name.startsWith("garmin_"))) continue;
    const read = (name: string): number | null => fields[`garmin_${name}`]?.value ?? null;
    days.push({
      date,
      readiness: read("training_readiness"),
      factors: {
        sleep: read("readiness_sleep"),
        recovery: read("readiness_recovery"),
        hrv: read("readiness_hrv"),
        load: read("readiness_load"),
        stress: read("readiness_stress"),
        sleepHistory: read("readiness_sleep_history"),
      },
      recoveryHours: read("recovery_time"),
      sleepScore: read("sleep_score"),
      sleepHours: read("sleep_hours"),
      sleepNeedHours: read("sleep_need_hours"),
      deepHours: read("sleep_deep_hours"),
      lightHours: read("sleep_light_hours"),
      remHours: read("sleep_rem_hours"),
      awakeHours: read("sleep_awake_hours"),
      awakenings: read("sleep_awakenings"),
      sleepStress: read("sleep_stress"),
      respiration: read("respiration"),
      sleepBatteryGain: read("sleep_battery_gain"),
      hrv: read("hrv"),
      hrvWeekly: read("hrv_weekly"),
      hrvStatus: read("hrv_status"),
      restingHr: read("resting_hr"),
      stress: read("stress"),
      steps: read("steps"),
      trainingLoad: read("training_load") ?? 0,
      acuteLoad: read("acute_load"),
      activityMinutes: read("activity_minutes") ?? 0,
      bodyBattery: read("body_battery"),
      bodyBatteryWake: read("body_battery_wake"),
      bodyBatteryHigh: read("body_battery_high"),
      bodyBatteryLow: read("body_battery_low"),
      charged: read("body_battery_charged"),
      drained: read("body_battery_drained"),
    });
  }
  return days;
}

type NumericField = { [K in keyof GarminDay]: GarminDay[K] extends number | null ? K : never }[keyof GarminDay];

/** The newest day that has `field`, with its date - scores land at different times. */
export function latestGarmin(days: GarminDay[], field: NumericField): { value: number; date: string } | null {
  for (let i = days.length - 1; i >= 0; i--) {
    const value = days[i][field];
    if (value != null) return { value, date: days[i].date };
  }
  return null;
}

// Garmin's own Training Readiness levels: Prime 95+, High 75-94, Moderate
// 50-74, Low 25-49, Poor below. Coloured on the same three-colour scale the
// site uses everywhere for readiness-type numbers.
export function readinessLevel(score: number): string {
  if (score >= 95) return "Prime";
  if (score >= 75) return "High";
  if (score >= 50) return "Moderate";
  if (score >= 25) return "Low";
  return "Poor";
}

export function readinessColor(score: number): string {
  if (score >= 75) return "var(--color-accent-2)";
  if (score >= 50) return "var(--color-amber)";
  return "var(--color-accent)";
}

// Codes written by scripts/garmin-sync.mjs (HRV_STATUS_CODES).
const HRV_STATUS_LABELS: Record<number, string> = { 0: "No status yet", 1: "Poor", 2: "Low", 3: "Unbalanced", 4: "Balanced" };

export function hrvStatusLabel(code: number | null): string | null {
  return code == null ? null : (HRV_STATUS_LABELS[code] ?? null);
}

export const GARMIN_SLEEP_COLOR = "#8FA9C5";
export const GARMIN_LOAD_COLOR = "#4B87F5";
export const GARMIN_BATTERY_COLOR = "#34d399";
