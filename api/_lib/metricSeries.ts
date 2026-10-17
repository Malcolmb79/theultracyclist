import { fetchStravaRides } from "../_routes/strava-activities.js";
import { fetchHealthHistory } from "../_routes/health-data.js";
import { fetchCoachingSettings } from "../_routes/coaching-settings.js";
import { irelandDateStr } from "./timeContext.js";
import { canonicalMetricId } from "./metricAliases.js";
import { convertValueUnit, type UnitSystem } from "./units.js";
import { isWeightFieldName } from "./weightField.js";

/**
 * Resolves a dashboard metric id to a labelled series, server-side.
 *
 * The browser builds these in useDashboardData from the same three sources.
 * This is the equivalent for anything rendering away from a browser - which so
 * far means the WhatsApp widget images. Drawing every widget by hand would have
 * meant one function per metric; resolving the series instead means one
 * renderer per *view* covers the whole catalog.
 *
 * Ids match useDashboardData exactly ("garmin.hrv", "strava.distance",
 * "health.<field>"). They are the athlete-facing contract - the coach names
 * them, the dashboard stores them in saved layouts - so they must not drift.
 */

export type MetricPoint = { date: string; value: number };
export type ResolvedMetric = { id: string; label: string; unit: string; series: MetricPoint[] };

// Garmin readings live in the health history as garmin_* fields (see
// scripts/garmin-sync.mjs); these are the dashboard's names for them.
const GARMIN_METRICS: Record<string, { label: string; unit: string; field: string }> = {
  "garmin.readiness": { label: "Training Readiness", unit: "", field: "garmin_training_readiness" },
  "garmin.hrv": { label: "HRV (overnight)", unit: "ms", field: "garmin_hrv" },
  "garmin.restingHr": { label: "Resting heart rate", unit: "bpm", field: "garmin_resting_hr" },
  "garmin.trainingLoad": { label: "Training load (day)", unit: "", field: "garmin_training_load" },
  "garmin.acuteLoad": { label: "Acute load (7-day)", unit: "", field: "garmin_acute_load" },
  "garmin.sleepScore": { label: "Sleep score", unit: "", field: "garmin_sleep_score" },
  "garmin.sleepHours": { label: "Sleep duration", unit: "h", field: "garmin_sleep_hours" },
  "garmin.bodyBatteryWake": { label: "Body Battery at wake", unit: "", field: "garmin_body_battery_wake" },
  "garmin.stress": { label: "Stress (day average)", unit: "", field: "garmin_stress" },
};

/** The plain Garmin metrics - drawable with the generic views, unlike the Garmin composites. */
export const GARMIN_METRIC_IDS = new Set(Object.keys(GARMIN_METRICS));

const STRAVA_METRICS: Record<string, { label: string; unit: string; pick: (r: Ride) => number | null | undefined }> = {
  "strava.distance": { label: "Ride distance", unit: "km", pick: (r) => r.distanceKm },
  "strava.movingTime": { label: "Ride duration", unit: "min", pick: (r) => r.movingTimeMinutes },
  "strava.avgPower": { label: "Ride avg power", unit: "W", pick: (r) => r.avgWatts },
  "strava.avgHeartrate": { label: "Ride avg heart rate", unit: "bpm", pick: (r) => r.avgHeartrate },
  "strava.relativeEffort": { label: "Ride relative effort", unit: "", pick: (r) => r.relativeEffort },
  "strava.elevationGain": { label: "Ride elevation gain", unit: "m", pick: (r) => r.elevationGainM },
};

type Ride = {
  startDate: string;
  distanceKm: number;
  movingTimeMinutes: number;
  avgWatts: number | null;
  avgHeartrate: number | null;
  relativeEffort: number | null;
  elevationGainM?: number;
};

// Apple Health field names are lower_snake_case; the dashboard title-cases them
// for display and calls out the energy ones, which read as "calories" to an
// athlete but never say so in the stored name.
function formatHealthLabel(name: string): string {
  const formatted = name
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  return name.includes("energy") ? `${formatted} (Calories)` : formatted;
}

export async function resolveMetric(requestedId: string, days = 60): Promise<ResolvedMetric | null> {
  const id = canonicalMetricId(requestedId);
  const settings = (await fetchCoachingSettings()) as { unitSystem?: string; heightCm?: number };
  const system: UnitSystem = settings.unitSystem === "imperial" ? "imperial" : "metric";
  const convert = (value: number, unit: string) => convertValueUnit(value, unit, system);

  if (id in GARMIN_METRICS) {
    const def = GARMIN_METRICS[id];
    const history = await fetchHealthHistory(days);
    const dates = Object.keys(history).sort();
    const hasGarmin = (date: string) => Object.keys(history[date]).some((n) => n.startsWith("garmin_"));
    const series = dates
      .map((date) => {
        const value = history[date][def.field]?.value;
        // A rest day has readings but no activity, so its load is 0, not missing.
        if (value == null) return id === "garmin.trainingLoad" && hasGarmin(date) ? { date, value: 0 } : null;
        return { date, value };
      })
      .filter((p): p is MetricPoint => p != null);
    return { id, label: def.label, unit: def.unit, series };
  }

  if (id in STRAVA_METRICS) {
    const def = STRAVA_METRICS[id];
    const rides = (await fetchStravaRides(200)) as Ride[];
    const converted = convert(1, def.unit);
    const series = rides
      .map((ride) => ({ date: irelandDateStr(new Date(ride.startDate)), value: def.pick(ride) }))
      .filter((p): p is MetricPoint => p.value != null)
      .map((p) => ({ ...p, value: convert(p.value, def.unit).value }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return { id, label: def.label, unit: converted.unit, series };
  }

  if (id === "health.bmi") {
    // Derived rather than stored - the dashboard computes it from weight and
    // the height in Settings, and so does this.
    const history = await fetchHealthHistory(days);
    const heightCm = settings.heightCm;
    if (!heightCm) return { id, label: "BMI", unit: "kg/m²", series: [] };
    const heightM = heightCm / 100;
    const series: MetricPoint[] = [];
    for (const date of Object.keys(history).sort()) {
      const key = Object.keys(history[date]).find((n) => isWeightFieldName(n));
      if (!key) continue;
      const { value, unit } = history[date][key];
      const kg = convertValueUnit(value, unit, "metric").value;
      series.push({ date, value: Math.round((kg / (heightM * heightM)) * 10) / 10 });
    }
    return { id, label: "BMI", unit: "kg/m²", series };
  }

  if (id.startsWith("health.")) {
    const field = id.slice("health.".length);
    const history = await fetchHealthHistory(days);
    const series: MetricPoint[] = [];
    let unit = "";
    for (const date of Object.keys(history).sort()) {
      const reading = history[date][field];
      if (!reading) continue;
      const next = convert(reading.value, reading.unit);
      unit = next.unit;
      series.push({ date, value: Math.round(next.value * 100) / 100 });
    }
    if (series.length === 0) return null;
    return { id, label: formatHealthLabel(field), unit, series };
  }

  return null;
}

/** Every metric id that can be resolved, for telling the coach what exists. */
export async function listMetricIds(): Promise<string[]> {
  const history = await fetchHealthHistory(60);
  const healthFields = [...new Set(Object.values(history).flatMap((day) => Object.keys(day)))];
  return [
    ...Object.keys(GARMIN_METRICS),
    ...Object.keys(STRAVA_METRICS),
    "health.bmi",
    // The raw garmin_* fields are offered as the garmin.* metrics above.
    ...healthFields.filter((f) => !f.startsWith("garmin_")).map((f) => `health.${f}`),
  ].sort();
}
