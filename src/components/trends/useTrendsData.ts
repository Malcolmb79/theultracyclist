import { useEffect, useMemo, useState } from "react";
import { GOAL_METRIC_IDS, type Goals } from "./types";
import { useUnits } from "../../context/UnitsContext";
import { convertTrendMetric } from "../../utils/units";
import { computeBmi } from "../../utils/bmi";

export type TrendMetricDef = {
  id: string;
  source: "whoop" | "strava" | "health" | "goal";
  label: string;
  unit: string;
  aggregation: "sum" | "avg";
  isGoal?: boolean;
  // "atLeast": met when actual >= goal (sleep, protein, fat, carbs, calories -
  //   fueling/recovery targets where under-shooting is the risk to flag).
  // "target": met when actual is within tolerance of goal (weight - a body
  //   composition target, not a minimum to clear).
  goalDirection?: "atLeast" | "target";
  getValue: (date: string) => number | null;
  getGoal?: (date: string) => number | null;
};

type WhoopDayRaw = {
  date: string;
  recovery: { score: number; hrvMs: number; restingHeartRate: number } | null;
  strain: { score: number; avgHeartRate: number; maxHeartRate: number; zone1to3Minutes: number; zone4to5Minutes: number } | null;
  sleep: { performancePercent: number; totalSleepHours: number } | null;
};

type StravaRide = { distanceKm: number; movingTimeMinutes: number; startDate: string };
type HealthHistory = Record<string, Record<string, { value: number; unit: string }>>;
type HealthCatalogEntry = { name: string; unit: string; days: number };

function formatMetricName(name: string): string {
  return name
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function findHealthKey(catalog: HealthCatalogEntry[], patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = catalog.find((c) => pattern.test(c.name));
    if (match) return match.name;
  }
  return null;
}

export type TrendsDataState =
  | { status: "loading" }
  | {
      status: "ready";
      days: string[]; // all dates with any data, chronological oldest first
      isTrainingDay: (date: string) => boolean;
      metrics: TrendMetricDef[];
      goals: Goals;
      saveGoals: (next: Goals) => Promise<void>;
    };

export function useTrendsData(): TrendsDataState {
  const { system } = useUnits();
  const [raw, setState] = useState<TrendsDataState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch("/api/whoop-data").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/strava-activities").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/health-data").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/trends-goals").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/coaching-settings").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([whoop, strava, health, goalsBody, settingsBody]) => {
        if (cancelled) return;

        const goals: Goals = goalsBody?.goals ?? {};
        const whoopDays = (whoop?.history as WhoopDayRaw[] | undefined) ?? [];
        const whoopByDate = new Map(whoopDays.map((d) => [d.date.slice(0, 10), d]));

        const rides = (strava?.rides as StravaRide[] | undefined) ?? [];
        const stravaByDate = new Map<string, StravaRide[]>();
        for (const ride of rides) {
          const date = ride.startDate.slice(0, 10);
          const list = stravaByDate.get(date) ?? [];
          list.push(ride);
          stravaByDate.set(date, list);
        }

        const healthHistory = (health?.history as HealthHistory | undefined) ?? {};
        const healthCatalog = (health?.catalog as HealthCatalogEntry[] | undefined) ?? [];

        const allDates = new Set<string>([...whoopByDate.keys(), ...stravaByDate.keys(), ...Object.keys(healthHistory)]);
        const days = Array.from(allDates).sort();

        const isTrainingDay = (date: string): boolean => {
          if (stravaByDate.has(date)) return true;
          const w = whoopByDate.get(date);
          return !!w?.strain && w.strain.zone1to3Minutes + w.strain.zone4to5Minutes > 0;
        };

        const metrics: TrendMetricDef[] = [
          {
            id: "whoop.recovery",
            source: "whoop",
            label: "Recovery score",
            unit: "%",
            aggregation: "avg",
            getValue: (date) => whoopByDate.get(date)?.recovery?.score ?? null,
          },
          {
            id: "whoop.strain",
            source: "whoop",
            label: "Strain",
            unit: "",
            aggregation: "avg",
            getValue: (date) => whoopByDate.get(date)?.strain?.score ?? null,
          },
          {
            id: "whoop.sleepPerformance",
            source: "whoop",
            label: "Sleep performance",
            unit: "%",
            aggregation: "avg",
            getValue: (date) => whoopByDate.get(date)?.sleep?.performancePercent ?? null,
          },
          {
            id: "whoop.sleepHours",
            source: "whoop",
            label: "Sleep duration",
            unit: "h",
            aggregation: "avg",
            getValue: (date) => whoopByDate.get(date)?.sleep?.totalSleepHours ?? null,
          },
          {
            id: "whoop.hrv",
            source: "whoop",
            label: "HRV",
            unit: "ms",
            aggregation: "avg",
            getValue: (date) => whoopByDate.get(date)?.recovery?.hrvMs ?? null,
          },
          {
            id: "whoop.restingHr",
            source: "whoop",
            label: "Resting heart rate",
            unit: "bpm",
            aggregation: "avg",
            getValue: (date) => whoopByDate.get(date)?.recovery?.restingHeartRate ?? null,
          },
          {
            id: "strava.distance",
            source: "strava",
            label: "Ride distance",
            unit: "km",
            aggregation: "sum",
            getValue: (date) => {
              const list = stravaByDate.get(date);
              return list ? Math.round(list.reduce((sum, r) => sum + r.distanceKm, 0) * 10) / 10 : null;
            },
          },
          {
            id: "strava.movingTime",
            source: "strava",
            label: "Ride duration",
            unit: "min",
            aggregation: "sum",
            getValue: (date) => {
              const list = stravaByDate.get(date);
              return list ? Math.round(list.reduce((sum, r) => sum + r.movingTimeMinutes, 0)) : null;
            },
          },
        ];

        for (const entry of healthCatalog) {
          metrics.push({
            id: `health.${entry.name}`,
            source: "health",
            label: entry.name.includes("energy") ? `${formatMetricName(entry.name)} (Calories)` : formatMetricName(entry.name),
            unit: entry.unit,
            aggregation: entry.unit === "kg" || entry.unit === "%" || entry.unit === "bpm" ? "avg" : "sum",
            getValue: (date) => healthHistory[date]?.[entry.name]?.value ?? null,
          });
        }

        // Goal-backed metrics. Field names are looked up dynamically since
        // the exact Apple Health field name for a given nutrient can vary
        // by source app - falls back gracefully to "no data" if none match.
        const weightKey = findHealthKey(healthCatalog, [/weight|body_mass/i]);
        const proteinKey = findHealthKey(healthCatalog, [/^protein$/i]);
        const fatKey = findHealthKey(healthCatalog, [/^total_fat$/i, /fat/i]);
        const carbsKey = findHealthKey(healthCatalog, [/carbohydrate/i]);
        const calorieKey = findHealthKey(healthCatalog, [/dietary_energy/i, /dietary.*calorie/i]);

        // Derived, not a direct Apple Health field - needs both a weight
        // reading (above) and a manually-entered height (Settings, since
        // Apple Health export doesn't reliably include it). Listed whenever
        // a weight metric exists, even before height is set (same as any
        // other metric with no data yet) - hiding the option entirely until
        // height was already configured left it undiscoverable.
        const heightCm = settingsBody?.settings?.heightCm as number | undefined;
        if (weightKey) {
          metrics.push({
            id: "health.bmi",
            source: "health",
            label: "BMI",
            unit: "kg/m²",
            aggregation: "avg",
            getValue: (date) => {
              if (!heightCm) return null;
              const weightKg = healthHistory[date]?.[weightKey]?.value;
              return weightKg == null ? null : computeBmi(weightKg, heightCm);
            },
          });
        }

        metrics.push(
          {
            id: GOAL_METRIC_IDS.weight,
            source: "goal",
            label: "Weight vs goal",
            unit: "kg",
            aggregation: "avg",
            isGoal: true,
            goalDirection: "target",
            getValue: (date) => (weightKey ? (healthHistory[date]?.[weightKey]?.value ?? null) : null),
            getGoal: () => goals.weightKg ?? null,
          },
          {
            id: GOAL_METRIC_IDS.sleep,
            source: "goal",
            label: "Sleep vs goal",
            unit: "h",
            aggregation: "avg",
            isGoal: true,
            goalDirection: "atLeast",
            getValue: (date) => whoopByDate.get(date)?.sleep?.totalSleepHours ?? null,
            getGoal: () => goals.sleepHours ?? null,
          },
          {
            id: GOAL_METRIC_IDS.protein,
            source: "goal",
            label: "Protein vs goal",
            unit: "g",
            aggregation: "sum",
            isGoal: true,
            goalDirection: "atLeast",
            getValue: (date) => (proteinKey ? (healthHistory[date]?.[proteinKey]?.value ?? null) : null),
            getGoal: () => goals.proteinG ?? null,
          },
          {
            id: GOAL_METRIC_IDS.fat,
            source: "goal",
            label: "Fat vs goal",
            unit: "g",
            aggregation: "sum",
            isGoal: true,
            goalDirection: "atLeast",
            getValue: (date) => (fatKey ? (healthHistory[date]?.[fatKey]?.value ?? null) : null),
            getGoal: () => goals.fatG ?? null,
          },
          {
            id: GOAL_METRIC_IDS.carbs,
            source: "goal",
            label: "Carbs vs goal",
            unit: "g",
            aggregation: "sum",
            isGoal: true,
            goalDirection: "atLeast",
            getValue: (date) => (carbsKey ? (healthHistory[date]?.[carbsKey]?.value ?? null) : null),
            getGoal: () => goals.carbsG ?? null,
          },
          {
            id: GOAL_METRIC_IDS.calories,
            source: "goal",
            label: "Calories vs goal",
            unit: "kcal",
            aggregation: "sum",
            isGoal: true,
            goalDirection: "atLeast",
            getValue: (date) => (calorieKey ? (healthHistory[date]?.[calorieKey]?.value ?? null) : null),
            getGoal: (date) => (isTrainingDay(date) ? (goals.calorieGoalTrainingDay ?? null) : (goals.calorieGoalRestDay ?? null)),
          },
        );

        const saveGoals = async (next: Goals) => {
          await fetch("/api/trends-goals", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(next),
          });
          setReloadToken((t) => t + 1);
        };

        setState({ status: "ready", days, isTrainingDay, metrics, goals, saveGoals });
      })
      .catch(() => {
        if (!cancelled) {
          setState({
            status: "ready",
            days: [],
            isTrainingDay: () => false,
            metrics: [],
            goals: {},
            saveGoals: async () => {},
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  return useMemo<TrendsDataState>(() => {
    if (raw.status !== "ready") return raw;
    return { ...raw, metrics: raw.metrics.map((m) => convertTrendMetric(m, system)) };
  }, [raw, system]);
}
