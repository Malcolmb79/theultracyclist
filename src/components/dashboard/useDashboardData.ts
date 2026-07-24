import { useEffect, useState } from "react";

export type SeriesPoint = { date: string; value: number };

export type MetricDef = {
  id: string;
  source: "strava" | "whoop" | "health";
  label: string;
  unit: string;
  series: SeriesPoint[]; // chronological, oldest first
  statOnly?: boolean; // true for single-value aggregates (no meaningful chart/timeline)
};

type WhoopRecovery = { score: number; hrvMs: number; restingHeartRate: number };
type WhoopStrain = { score: number; avgHeartRate: number; maxHeartRate: number };
type WhoopSleep = { performancePercent: number; totalSleepHours: number };
type WhoopDay = { date: string; recovery: WhoopRecovery | null; strain: WhoopStrain | null; sleep: WhoopSleep | null };

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
  return name
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export type DashboardDataState =
  | { status: "loading" }
  | { status: "ready"; metrics: MetricDef[] };

export function useDashboardData(): DashboardDataState {
  const [state, setState] = useState<DashboardDataState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch("/api/whoop-data").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/strava-activities").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/health-data").then((r) => (r.ok ? r.json() : null)),
    ]).then(([whoop, strava, health]) => {
      if (cancelled) return;

      const metrics: MetricDef[] = [];

      if (whoop?.history) {
        const days = (whoop.history as WhoopDay[]).slice().reverse();
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
      }

      setState({ status: "ready", metrics });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
