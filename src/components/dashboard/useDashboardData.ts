import { useMemo } from "react";
import { HEALTH_CALENDAR_ID, BODY_BATTERY_ID, GARMIN_LOAD_READINESS_COMBO_ID, GARMIN_RINGS_ID, GARMIN_BATTERY_TIMELINE_ID, CALORIES_BALANCE_ID, MACRO_SPLIT_ID, PERFORMANCE_CHART_ID, WEATHER_ID, GARMIN_LIVETRACK_ID, LIVE_TRACKER_ID, ALL_ACTIVITY_ID } from "./types";
import { useUnits } from "../../context/UnitsContext";
import { garminDaysFrom, type GarminDay } from "../../utils/garmin";
import { convertMetricSeries, convertValueUnit } from "../../utils/units";
import { computeBmi, findWeightMetricName } from "../../utils/bmi";
import { MACRO_ORDER, findMacroField } from "../../utils/macros";
import { computePerformanceSeries, type PerformancePoint } from "../../utils/performanceSeries";
import { irelandTodayDateStr } from "../../utils/irelandDate";
import type { RawSourcesState } from "../../utils/useRawSources";

export type SeriesPoint = { date: string; value: number };

export type MetricDef = {
  id: string;
  source: "strava" | "health" | "weather" | "garmin";
  label: string;
  unit: string;
  series: SeriesPoint[]; // chronological, oldest first
  statOnly?: boolean; // true for single-value aggregates (no meaningful chart/timeline)
  /** Kept resolvable for existing widgets and internal reads, but not offered in the catalog. */
  hidden?: boolean;
};


type StravaRide = {
  id: number;
  name: string;
  distanceKm: number;
  movingTimeMinutes: number;
  startDate: string;
  avgWatts: number | null;
  weightedAvgWatts: number | null;
  avgHeartrate: number | null;
  relativeEffort: number | null;
  elevationGainM?: number;
  elevationProfile: { distanceKm: number; altitudeM: number }[];
};

type StravaPeriodSummary = { distanceKm: number; movingTimeMinutes: number; elevationGainM: number };

type HealthMetricValue = { value: number; unit: string };
type HealthHistory = Record<string, Record<string, HealthMetricValue>>;
type HealthCatalogEntry = { name: string; unit: string; days: number };

function elevationGain(points: { altitudeM: number }[]): number {
  return points.reduce((gain, p, i) => {
    if (i === 0) return gain;
    const delta = p.altitudeM - points[i - 1].altitudeM;
    return delta > 0 ? gain + delta : gain;
  }, 0);
}

function formatMetricName(name: string): string {
  const formatted = name
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  // Apple Health's own field names ("Active Energy", "Dietary Energy", etc.)
  // don't use the word "calories" anywhere, making them easy to miss when
  // scanning the catalog for calorie data - call it out explicitly.
  return name.includes("energy") ? `${formatted} (Calories)` : formatted;
}

export type DashboardDataState =
  | { status: "loading" }
  | {
      status: "ready";
      metrics: MetricDef[];
      garminHistory: GarminDay[];
      performanceSeries: PerformancePoint[];
      /** The athlete's targets, passed straight through for goal-aware widgets. */
      goals: Record<string, unknown>;
    };

export function useDashboardData(raw: RawSourcesState): DashboardDataState {
  const { system } = useUnits();

  return useMemo<DashboardDataState>(() => {
    if (raw.status !== "ready") return { status: "loading" };

    const strava = raw.strava as
      | { rides?: StravaRide[]; summary?: { weekly?: StravaPeriodSummary; monthly?: StravaPeriodSummary } }
      | null;
    const health = raw.health as { catalog?: HealthCatalogEntry[]; history?: HealthHistory } | null;
    const settings = raw.settings;
    const planned = raw.planned;
    const trainingPeaks = raw.trainingPeaks;

    const metrics: MetricDef[] = [];
      let garminHistory: GarminDay[] = [];
      let performanceSeries: PerformancePoint[] = [];

      // Always offered, independent of any connected data source - it's a
      // live location snapshot, not derived from Garmin/Strava/Health.
      metrics.push({ id: WEATHER_ID, source: "weather", label: "Weather", unit: "", series: [], statOnly: true });
      metrics.push({ id: GARMIN_LIVETRACK_ID, source: "garmin", label: "Garmin LiveTrack", unit: "", series: [], statOnly: true });
      // Reads /api/live.json directly, so it is offered regardless of which
      // of Strava/Garmin/Health happen to be connected - those only see a
      // ride once it has been saved and synced, which is hours too late to
      // be "live".
      metrics.push({ id: LIVE_TRACKER_ID, source: "garmin", label: "Live ride data", unit: "", series: [], statOnly: true });
      // Reads its own endpoint rather than the shared Strava fetch, which is
      // ride-filtered on purpose, so it is offered whatever else connected.
      metrics.push({ id: ALL_ACTIVITY_ID, source: "strava", label: "All activity", unit: "", series: [], statOnly: true });

      if (strava?.rides) {
        const rides = (strava.rides as StravaRide[]).slice().reverse();
        const series = (pick: (r: StravaRide) => number | null | undefined): SeriesPoint[] =>
          rides
            .map((r) => ({ date: r.startDate, value: pick(r) }))
            .filter((p): p is SeriesPoint => p.value != null);

        metrics.push(
          { id: "strava.distance", source: "strava", label: "Ride distance", unit: "km", series: series((r) => r.distanceKm) },
          { id: "strava.movingTime", source: "strava", label: "Ride duration", unit: "min", series: series((r) => r.movingTimeMinutes) },
          { id: "strava.avgPower", source: "strava", label: "Ride avg power", unit: "W", series: series((r) => r.avgWatts) },
          { id: "strava.avgHeartrate", source: "strava", label: "Ride avg heart rate", unit: "bpm", series: series((r) => r.avgHeartrate) },
          { id: "strava.relativeEffort", source: "strava", label: "Ride relative effort", unit: "", series: series((r) => r.relativeEffort) },
          // Strava's own total for the ride, not summed from the elevation
          // profile: profiles are only fetched for the most recent handful now
          // (see fetchStravaRides), and deriving it meant this metric silently
          // had no value for any older ride.
          { id: "strava.elevationGain", source: "strava", label: "Ride elevation gain", unit: "m", series: series((r) => r.elevationGainM ?? (r.elevationProfile.length > 1 ? Math.round(elevationGain(r.elevationProfile)) : null)) },
        );

        performanceSeries = computePerformanceSeries(
          rides,
          settings.ftpWatts as number | undefined,
          irelandTodayDateStr(),
          undefined,
          planned,
          trainingPeaks ?? undefined,
        );
        if (performanceSeries.length > 0) {
          metrics.push({ id: PERFORMANCE_CHART_ID, source: "strava", label: "ATP Progress / Performance Chart", unit: "", series: [], statOnly: true });
        }

        const weekly = strava.summary?.weekly as StravaPeriodSummary | undefined;
        const monthly = strava.summary?.monthly as StravaPeriodSummary | undefined;
        const today = rides[rides.length - 1]?.startDate ?? new Date().toISOString();
        if (weekly) {
          metrics.push(
            { id: "strava.weeklyDistance", source: "strava", label: "Weekly distance", unit: "km", series: [{ date: today, value: weekly.distanceKm }], statOnly: true },
            { id: "strava.weeklyElevation", source: "strava", label: "Weekly elevation", unit: "m", series: [{ date: today, value: weekly.elevationGainM }], statOnly: true },
          );
        }
        if (monthly) {
          metrics.push(
            { id: "strava.monthlyDistance", source: "strava", label: "Monthly distance", unit: "km", series: [{ date: today, value: monthly.distanceKm }], statOnly: true },
            { id: "strava.monthlyElevation", source: "strava", label: "Monthly elevation", unit: "m", series: [{ date: today, value: monthly.elevationGainM }], statOnly: true },
          );
        }
      }

      if (health?.catalog && health?.history) {
        const catalog = health.catalog as HealthCatalogEntry[];
        const history = health.history as HealthHistory;
        const dates = Object.keys(history).sort();

        for (const entry of catalog) {
          const series: SeriesPoint[] = dates
            .map((date) => ({ date, value: history[date][entry.name]?.value }))
            .filter((p): p is SeriesPoint => p.value != null);

          metrics.push({
            id: `health.${entry.name}`,
            source: "health",
            label: formatMetricName(entry.name),
            unit: entry.unit,
            series,
            // Offered below as first-class Garmin metrics instead.
            hidden: entry.name.startsWith("garmin_"),
          });
        }

        // Derived, not a direct Apple Health field - needs both a weight
        // reading (from the catalog above) and a manually-entered height
        // (Settings, since Apple Health export doesn't reliably include it).
        // Listed whenever a weight metric exists, even before height is set
        // (same as any other metric with no data yet) - hiding the option
        // entirely until height was already configured left it undiscoverable.
        const heightCm = settings.heightCm as number | undefined;
        const weightName = findWeightMetricName(catalog);
        // Apple Health may export weight in lb or kg depending on the
        // athlete's device unit settings - BMI math needs real kilograms
        // regardless of that, so normalize using the catalog's own unit
        // rather than assuming the raw stored number is already kg.
        const weightUnit = catalog.find((c) => c.name === weightName)?.unit ?? "kg";
        if (weightName) {
          const bmiSeries: SeriesPoint[] = heightCm
            ? dates
                .map((date) => {
                  const weightRaw = history[date][weightName]?.value;
                  if (weightRaw == null) return null;
                  const weightKg = convertValueUnit(weightRaw, weightUnit, "metric").value;
                  return { date, value: computeBmi(weightKg, heightCm) };
                })
                .filter((p): p is SeriesPoint => p != null)
            : [];

          metrics.push({ id: "health.bmi", source: "health", label: "BMI", unit: "kg/m²", series: bmiSeries });
        }

        // Listed whenever either side of the comparison exists in the
        // catalog - the widget itself shows "—" for whichever side is
        // actually missing, same as any other metric with partial data.
        const hasCaloriesData = catalog.some((c) => /dietary_energy|active_energy/i.test(c.name));
        if (hasCaloriesData) {
          metrics.push({ id: CALORIES_BALANCE_ID, source: "health", label: "Calories: Consumed vs Burned", unit: "", series: [], statOnly: true });
        }

        // Offered as soon as any one macro is being logged - the card shows
        // "—" for whichever of the three is missing, rather than the option
        // disappearing until all three happen to be present.
        const hasMacroData = MACRO_ORDER.some((key) => findMacroField(catalog, key) != null);
        if (hasMacroData) {
          metrics.push({ id: MACRO_SPLIT_ID, source: "health", label: "Macro split (Carbs/Fat/Protein)", unit: "", series: [], statOnly: true });
        }

        garminHistory = garminDaysFrom(history);
        if (garminHistory.length > 0) {
          const series = (pick: (d: GarminDay) => number | null): SeriesPoint[] =>
            garminHistory.map((d) => ({ date: d.date, value: pick(d) })).filter((p): p is SeriesPoint => p.value != null);
          metrics.push(
            { id: "garmin.readiness", source: "garmin", label: "Training Readiness", unit: "", series: series((d) => d.readiness) },
            { id: "garmin.hrv", source: "garmin", label: "HRV (overnight)", unit: "ms", series: series((d) => d.hrv) },
            { id: "garmin.restingHr", source: "garmin", label: "Resting heart rate", unit: "bpm", series: series((d) => d.restingHr) },
            { id: "garmin.trainingLoad", source: "garmin", label: "Training load (day)", unit: "", series: series((d) => d.trainingLoad) },
            { id: "garmin.acuteLoad", source: "garmin", label: "Acute load (7-day)", unit: "", series: series((d) => d.acuteLoad) },
            { id: "garmin.sleepScore", source: "garmin", label: "Sleep score", unit: "", series: series((d) => d.sleepScore) },
            { id: "garmin.sleepHours", source: "garmin", label: "Sleep duration", unit: "h", series: series((d) => d.sleepHours) },
            { id: "garmin.bodyBatteryWake", source: "garmin", label: "Body Battery at wake", unit: "", series: series((d) => d.bodyBatteryWake) },
            { id: "garmin.stress", source: "garmin", label: "Stress (day average)", unit: "", series: series((d) => d.stress) },
            { id: GARMIN_LOAD_READINESS_COMBO_ID, source: "garmin", label: "Training Load & Readiness", unit: "", series: [], statOnly: true },
            { id: GARMIN_RINGS_ID, source: "garmin", label: "Sleep, Readiness, Body Battery & Load", unit: "", series: [], statOnly: true },
            { id: HEALTH_CALENDAR_ID, source: "garmin", label: "Health Calendar", unit: "", series: [], statOnly: true },
            { id: GARMIN_BATTERY_TIMELINE_ID, source: "garmin", label: "Body Battery Timeline", unit: "", series: [], statOnly: true },
          );
        }
      }

      if (garminHistory.length > 0) {
        metrics.push({ id: BODY_BATTERY_ID, source: "garmin", label: "Body Battery", unit: "", series: [], statOnly: true });
      }

    return {
      status: "ready",
      metrics: metrics.map((m) => convertMetricSeries(m, system)),
      garminHistory,
      performanceSeries,
      goals: raw.goals,
    };
  }, [raw, system]);
}
