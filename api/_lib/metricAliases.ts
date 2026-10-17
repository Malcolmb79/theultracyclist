// Whoop was replaced by Garmin. Saved layouts, coach replies and old WhatsApp
// links still name Whoop's widget ids, so each maps to the Garmin widget that
// took its place. Mirrored in src/utils/metricAliases.ts for the browser.
const LEGACY_METRIC_IDS: Record<string, string> = {
  "whoop.recovery": "garmin.readiness",
  "whoop.hrv": "garmin.hrv",
  "whoop.restingHr": "garmin.restingHr",
  "whoop.strain": "garmin.trainingLoad",
  "whoop.sleepPerformance": "garmin.sleepScore",
  "whoop.sleepHours": "garmin.sleepHours",
  "whoop.strainRecoveryCombo": "garmin.loadReadinessCombo",
  "whoop.sleepRecoveryStrainRings": "garmin.sleepReadinessBatteryRings",
  "whoop.healthCalendar": "garmin.healthCalendar",
  "whoop.bodyBattery": "garmin.bodyBattery",
};

export function canonicalMetricId(id: string): string {
  return LEGACY_METRIC_IDS[id] ?? id;
}
