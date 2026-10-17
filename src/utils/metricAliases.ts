// Whoop was replaced by Garmin. Saved layouts on every page still name
// Whoop's widgets, so each maps to the Garmin widget that took its place as
// the layout loads, and the next save stores the new id. Mirrored in
// api/_lib/metricAliases.ts for server-side reads.
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

// Whoop-only figures with nothing equivalent in Garmin's data.
const RETIRED_METRIC_IDS = new Set(["whoop.strainAvgHr"]);

// A widget still carrying its Whoop default title takes the Garmin one; a
// title the athlete chose is left alone.
const LEGACY_LABELS: Record<string, string> = {
  "Recovery score": "Training Readiness",
  Recovery: "Training Readiness",
  Strain: "Training load",
  "Sleep performance": "Sleep score",
  "Strain & Recovery": "Training Load & Readiness",
  "Sleep, Recovery & Strain": "Sleep, Readiness, Body Battery & Load",
};

export function canonicalMetricId(id: string): string {
  return LEGACY_METRIC_IDS[id] ?? id;
}

/** Upgrades a saved widget list: Whoop ids become their Garmin replacements; retired ones go. */
export function migrateWidgets<T extends { metric?: string; source?: string; label?: string }>(widgets: T[]): T[] {
  return widgets
    .filter((w) => !w.metric || !RETIRED_METRIC_IDS.has(w.metric))
    .map((w) => {
      if (!w.metric) return w;
      const metric = canonicalMetricId(w.metric);
      if (metric === w.metric && w.source !== "whoop") return w;
      const label = w.label && metric !== w.metric ? (LEGACY_LABELS[w.label] ?? w.label) : w.label;
      return { ...w, metric, label, ...(w.source === "whoop" ? { source: "garmin" } : {}) };
    });
}
