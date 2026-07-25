import { useEffect, useMemo, useState } from "react";
import { WHOOP_STRAIN_RECOVERY_COMBO_ID, WHOOP_RINGS_COMBO_ID } from "./types";
import { useUnits } from "../../context/UnitsContext";
import { convertMetricSeries } from "../../utils/units";
import { computeBmi, findWeightMetricName } from "../../utils/bmi";

export type SeriesPoint = { date: string; value: number };

export type MetricDef = {
  id: string;
  source: "strava" | "whoop" | "health";
  label: string;
  unit: string;
  series: SeriesPoint[]; // chronological, oldest first
  statOnly?: boolean; // true for single-value aggregates (no meaningful chart/timeline)
};

export type WhoopRecovery = { score: number; hrvMs: number; restingHeartRate: number };
export type WhoopStrain = { score: number; avgHeartRate: number; maxHeartRate: number; zone1to3Minutes: number; zone4to5Minutes: number };
export type WhoopSleep = {
  performancePercent: number;
  totalSleepHours: number;
  consistencyPercent: number;
  efficiencyPercent: number;
  hoursNeeded: number;
  respiratoryRate: number;
};
export type WhoopDay = { date: string; recovery: WhoopRecovery | null; strain: WhoopStrain | null; sleep: WhoopSleep | null };

type StravaRide = {
  id: number;
  name: string;
  distanceKm: number;
  movingTimeMinutes: number;
  startDate: string;
  avgWatts: number | null;
  avgHeartrate: number | null;
  relativeEffort: number | null;
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
  | { status: "ready"; metrics: MetricDef[]; whoopHistory: WhoopDay[] };

type RawData = { metrics: MetricDef[]; whoopHistory: WhoopDay[] };

export function useDashboardData(): DashboardDataState {
  const { system } = useUnits();
  const [raw, setRaw] = useState<RawData | null>(null);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch("/api/whoop-data").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/strava-activities").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/health-data").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/coaching-settings").then((r) => (r.ok ? r.json() : null)),
    ]).then(([whoop, strava, health, settingsBody]) => {
      if (cancelled) return;

      const metrics: MetricDef[] = [];
      let whoopHistory: WhoopDay[] = [];

      if (whoop?.history) {
        const days = (whoop.history as WhoopDay[]).slice().reverse();
        whoopHistory = days;
        const series = (pick: (d: WhoopDay) => number | null | undefined): SeriesPoint[] =>
          days
            .map((d) => ({ date: d.date, value: pick(d) }))
            .filter((p): p is SeriesPoint => p.value != null);

        metrics.push(
          { id: "whoop.recovery", source: "whoop", label: "Recovery score", unit: "%", series: series((d) => d.recovery?.score) },
          { id: "whoop.hrv", source: "whoop", label: "HRV", unit: "ms", series: series((d) => d.recovery?.hrvMs) },
          { id: "whoop.restingHr", source: "whoop", label: "Resting heart rate", unit: "bpm", series: series((d) => d.recovery?.restingHeartRate) },
          { id: "whoop.strain", source: "whoop", label: "Strain", unit: "", series: series((d) => d.strain?.score) },
          { id: "whoop.strainAvgHr", source: "whoop", label: "Strain avg heart rate", unit: "bpm", series: series((d) => d.strain?.avgHeartRate) },
          { id: "whoop.sleepPerformance", source: "whoop", label: "Sleep performance", unit: "%", series: series((d) => d.sleep?.performancePercent) },
          { id: "whoop.sleepHours", source: "whoop", label: "Sleep duration", unit: "h", series: series((d) => d.sleep?.totalSleepHours) },
          { id: WHOOP_STRAIN_RECOVERY_COMBO_ID, source: "whoop", label: "Strain & Recovery", unit: "", series: [], statOnly: true },
          { id: WHOOP_RINGS_COMBO_ID, source: "whoop", label: "Sleep, Recovery & Strain", unit: "", series: [], statOnly: true },
        );
      }

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
          { id: "strava.elevationGain", source: "strava", label: "Ride elevation gain", unit: "m", series: series((r) => (r.elevationProfile.length > 1 ? Math.round(elevationGain(r.elevationProfile)) : null)) },
        );

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
          });
        }

        // Derived, not a direct Apple Health field - needs both a weight
        // reading (from the catalog above) and a manually-entered height
        // (Settings, since Apple Health export doesn't reliably include it).
        const heightCm = settingsBody?.settings?.heightCm as number | undefined;
        const weightName = findWeightMetricName(catalog);
        if (heightCm && weightName) {
          const bmiSeries: SeriesPoint[] = dates
            .map((date) => {
              const weightKg = history[date][weightName]?.value;
              return weightKg == null ? null : { date, value: computeBmi(weightKg, heightCm) };
            })
            .filter((p): p is SeriesPoint => p != null);

          if (bmiSeries.length > 0) {
            metrics.push({ id: "health.bmi", source: "health", label: "BMI", unit: "kg/m²", series: bmiSeries });
          }
        }
      }

      setRaw({ metrics, whoopHistory });
    }).catch(() => {
      if (!cancelled) setRaw({ metrics: [], whoopHistory: [] });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo<DashboardDataState>(() => {
    if (!raw) return { status: "loading" };
    return {
      status: "ready",
      metrics: raw.metrics.map((m) => convertMetricSeries(m, system)),
      whoopHistory: raw.whoopHistory,
    };
  }, [raw, system]);
}
