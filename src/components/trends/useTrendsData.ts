import { useEffect, useMemo, useState } from "react";
import { GOAL_METRIC_IDS, PROGRESS_PHOTOS_ID, type DatedGoal, type Goals } from "./types";
import { HEALTH_CALENDAR_ID, MACRO_SPLIT_ID, PERFORMANCE_CHART_ID } from "../dashboard/types";
import { useUnits } from "../../context/UnitsContext";
import { convertTrendMetric, convertValueUnit } from "../../utils/units";
import { computeBmi } from "../../utils/bmi";
import { computeTss } from "../../utils/tss";
import { computeFitnessSeries } from "../../utils/fitness";
import { getAtpWeekFor } from "../../utils/atpPlan";
import { computePerformanceSeries, type PerformancePoint } from "../../utils/performanceSeries";
import { irelandDateStr } from "../../utils/irelandDate";
import { today } from "./aggregate";

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
  // Absolute +/- tolerance for a "target"-direction goal. Defaults to the
  // weight tolerance (0.5) in aggregate.ts's isGoalMet if omitted - metrics
  // on a different numeric scale (CTL/TSB) must set their own.
  goalTolerance?: number;
  getValue: (date: string) => number | null;
  getGoal?: (date: string) => number | null;
};

type WhoopDayRaw = {
  date: string;
  recovery: { score: number; hrvMs: number; restingHeartRate: number } | null;
  strain: { score: number; avgHeartRate: number; maxHeartRate: number; zone1to3Minutes: number; zone4to5Minutes: number } | null;
  sleep: {
    performancePercent: number;
    totalSleepHours: number;
    consistencyPercent: number;
    efficiencyPercent: number;
    hoursNeeded: number;
    respiratoryRate: number;
  } | null;
};

type StravaRide = {
  distanceKm: number;
  movingTimeMinutes: number;
  startDate: string;
  avgWatts: number | null;
  weightedAvgWatts: number | null;
};
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
      // For the Health Calendar widget only - everything else here works off
      // the getValue-per-metric shape above, but a multi-metric-per-day
      // calendar needs the raw day objects and weight/BMI-by-date directly.
      whoopHistory: WhoopDayRaw[];
      weightByDate: Map<string, number>;
      weightUnit: string;
      bmiByDate: Map<string, number>;
      performanceSeries: PerformancePoint[];
      /** Goals that have a deadline, for the progress views. */
      datedGoals: Record<"weight" | "ftp" | "sleepWeekly", DatedGoal>;
      /**
       * Every Apple Health weight reading, in the unit the user reads in.
       *
       * Separate from weightByDate, which is kg for the calculations that need
       * it (BMI). A chart drawn from one and labelled from the other is how a
       * kg figure ends up with lb beside it.
       */
      weightSeries: { date: string; value: number }[];
    };

export function useTrendsData(): TrendsDataState {
  const { system } = useUnits();
  const [raw, setState] = useState<TrendsDataState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch("/api/whoop-data").then((r) => (r.ok ? r.json() : null)),
      // A generous count (not the default 6 "recent rides" list) so CTL's
      // 42-day window has real history behind it rather than ramping up
      // from an artificially recent start - see useTrendsData's CTL/ATL/TSB
      // metrics below.
      fetch("/api/strava-activities?count=200").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/health-data").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/trends-goals").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/coaching-settings").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([whoop, strava, health, goalsBody, settingsBody]) => {
        if (cancelled) return;

        const goals: Goals = goalsBody?.goals ?? {};
        const whoopDays = (whoop?.history as WhoopDayRaw[] | undefined) ?? [];
        // Whoop cycle starts and Strava start dates are both full UTC
        // timestamps, so a raw .slice(0, 10) buckets them by the UTC calendar
        // day - which is the previous day for anything between Irish midnight
        // and 1am during BST. An 00:30 start to a long ride belonged to
        // yesterday; the whole app reads these by Irish day instead.
        const whoopByDate = new Map(whoopDays.map((d) => [irelandDateStr(new Date(d.date)), d]));

        const rides = (strava?.rides as StravaRide[] | undefined) ?? [];
        const stravaByDate = new Map<string, StravaRide[]>();
        for (const ride of rides) {
          const date = irelandDateStr(new Date(ride.startDate));
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
          {
            id: "strava.tss",
            source: "strava",
            label: "TSS",
            unit: "",
            aggregation: "sum",
            getValue: (date) => {
              const list = stravaByDate.get(date);
              if (!list) return null;
              const ftpWatts = settingsBody?.settings?.ftpWatts as number | undefined;
              const total = list.reduce((sum, r) => sum + (computeTss(r.weightedAvgWatts ?? r.avgWatts, r.movingTimeMinutes, ftpWatts) ?? 0), 0);
              return Math.round(total * 10) / 10;
            },
          },
        ];

        // CTL/ATL/TSB (fitness/fatigue/form) - a running series computed
        // once over the full ride history rather than per-metric-per-date,
        // since each day's value depends on every prior day's (see
        // computeFitnessSeries). "avg" aggregation since these are
        // snapshot/level values, not additive like distance or TSS.
        {
          const ftpWatts = settingsBody?.settings?.ftpWatts as number | undefined;
          const dailyTssByDate = new Map<string, number>();
          let earliestRideDate: string | null = null;
          for (const ride of rides) {
            const date = irelandDateStr(new Date(ride.startDate));
            const tss = computeTss(ride.weightedAvgWatts ?? ride.avgWatts, ride.movingTimeMinutes, ftpWatts) ?? 0;
            dailyTssByDate.set(date, (dailyTssByDate.get(date) ?? 0) + tss);
            if (!earliestRideDate || date < earliestRideDate) earliestRideDate = date;
          }

          if (earliestRideDate) {
            const fitnessSeries = computeFitnessSeries(dailyTssByDate, earliestRideDate, today());
            metrics.push(
              {
                id: "strava.ctl",
                source: "strava",
                label: "Fitness (CTL)",
                unit: "",
                aggregation: "avg",
                isGoal: true,
                goalDirection: "target",
                // CTL runs 0-130+ over the season, so weight's 0.5 tolerance
                // would flag "off track" for noise - a few points either
                // side of the plan's target for the week is still on track.
                goalTolerance: 5,
                getValue: (date) => fitnessSeries.get(date)?.ctl ?? null,
                getGoal: (date) => getAtpWeekFor(date)?.ctlTarget ?? null,
              },
              {
                id: "strava.atl",
                source: "strava",
                label: "Fatigue (ATL)",
                unit: "",
                aggregation: "avg",
                getValue: (date) => fitnessSeries.get(date)?.atl ?? null,
              },
              {
                id: "strava.tsb",
                source: "strava",
                label: "Form (TSB)",
                unit: "",
                aggregation: "avg",
                isGoal: true,
                goalDirection: "target",
                // TSB swings much wider than CTL across the plan (e.g. a
                // deep-build week near -30 vs a taper/race week near +60),
                // so it needs a wider tolerance than CTL to mean "on track".
                goalTolerance: 8,
                getValue: (date) => fitnessSeries.get(date)?.tsb ?? null,
                getGoal: (date) => getAtpWeekFor(date)?.tsbTarget ?? null,
              },
            );
          }
        }

        const performanceSeries = computePerformanceSeries(rides, settingsBody?.settings?.ftpWatts as number | undefined, today());
        if (performanceSeries.length > 0) {
          // Performance Management Chart: a dedicated multi-line view
          // (actual CTL/ATL/TSB plus dashed ATP targets), not the day/week/
          // month aggregate every other metric uses - getValue is never
          // actually called since TrendsWidget special-cases this id before
          // reaching that logic, matching HEALTH_CALENDAR_ID's own stub.
          metrics.push({
            id: PERFORMANCE_CHART_ID,
            source: "strava",
            label: "ATP Progress / Performance Chart",
            unit: "",
            aggregation: "avg",
            getValue: () => null,
          });
        }

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
        // Apple Health may export weight in lb or kg depending on the
        // athlete's device unit settings - both metrics below need real
        // kilograms, so normalize using the catalog's own unit rather than
        // assuming the raw stored number is already kg.
        const weightUnit = healthCatalog.find((c) => c.name === weightKey)?.unit ?? "kg";
        const weightKg = (date: string): number | null => {
          const raw = weightKey ? healthHistory[date]?.[weightKey]?.value : null;
          return raw == null ? null : convertValueUnit(raw, weightUnit, "metric").value;
        };
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
              const kg = weightKg(date);
              return kg == null ? null : computeBmi(kg, heightCm);
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
            getValue: (date) => weightKg(date),
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
          // Rendered as its own card (see TrendsWidget), so getValue is never
          // read - it exists as a metric purely to appear in the catalog
          // alongside the per-macro goal widgets it summarises.
          {
            id: MACRO_SPLIT_ID,
            source: "goal",
            label: "Macro split (Carbs/Fat/Protein)",
            unit: "",
            aggregation: "sum",
            getValue: () => null,
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

          {
            /*
             * The nightly target counted over a week: each night scores one if
             * it cleared the target and nothing if it didn't, so the daily view
             * is hit-or-miss and the weekly view is nights out of seven.
             *
             * A weekly hours total was tried first and is the wrong shape: it
             * hides four short nights behind one long lie-in, and needs a
             * second target kept in step with the nightly one.
             */
            id: GOAL_METRIC_IDS.sleepWeekly,
            source: "goal",
            label: "Nights on sleep target",
            unit: "",
            aggregation: "sum",
            isGoal: true,
            goalDirection: "atLeast",
            getValue: (date) => {
              const hours = whoopByDate.get(date)?.sleep?.totalSleepHours;
              if (hours == null || goals.sleepHours == null) return null;
              return hours >= goals.sleepHours ? 1 : 0;
            },
            // One per night, so a week's worth sums to seven.
            getGoal: () => (goals.sleepHours != null ? 1 : null),
          },
          {
            // Flat across every day: FTP is a tested figure that holds until
            // it is retested, not something measured daily. The value of this
            // metric is the progress view, not the per-day comparison.
            id: GOAL_METRIC_IDS.ftp,
            source: "goal",
            label: "FTP vs goal",
            unit: "W",
            aggregation: "avg",
            isGoal: true,
            goalDirection: "atLeast",
            getValue: () => (settingsBody?.settings?.ftpWatts as number | undefined) ?? null,
            getGoal: () => goals.ftpTargetWatts ?? null,
          },
        );

        // Health Calendar: one calendar with Strain/Recovery/Sleep/HRV/
        // Weight per day, rather than the day/week/month aggregate every
        // other metric uses - getValue is never actually called since
        // TrendsWidget special-cases this id before reaching that logic.
        // Not a metric — it has no series and no time range. It is listed
        // here because the catalogue is how anything gets onto the page, the
        // same accommodation the health calendar already needed.
        metrics.push({
          id: PROGRESS_PHOTOS_ID,
          source: "health",
          label: "Progress photos",
          unit: "",
          aggregation: "avg",
          getValue: () => null,
        });

        metrics.push({
          id: HEALTH_CALENDAR_ID,
          source: "whoop",
          label: "Health Calendar",
          unit: "",
          aggregation: "avg",
          getValue: () => null,
        });

        const weightByDate = new Map<string, number>();
        const bmiByDate = new Map<string, number>();
        for (const date of days) {
          const kg = weightKg(date);
          if (kg != null) weightByDate.set(date, kg);
          if (kg != null && heightCm) bmiByDate.set(date, computeBmi(kg, heightCm));
        }

        const saveGoals = async (next: Goals) => {
          await fetch("/api/trends-goals", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(next),
          });
          setReloadToken((t) => t + 1);
        };

        /**
         * Where a metric stood when it was first recorded, so progress has
         * something to measure from. Without it a goal can only be reported
         * as reached or not — 80kg against a 78kg target is halfway from 82
         * and nowhere near from 79, and the two look identical otherwise.
         */
        const firstRecorded = (byDate: Map<string, number>): number | null => {
          for (const date of days) {
            const value = byDate.get(date);
            if (value != null) return value;
          }
          return null;
        };
        const lastRecorded = (byDate: Map<string, number>): number | null => {
          for (let i = days.length - 1; i >= 0; i--) {
            const value = byDate.get(days[i]);
            if (value != null) return value;
          }
          return null;
        };

        // Sleep over the last seven days that have a reading, against the
        // weekly target.
        const sleepByDate = new Map<string, number>();
        for (const date of days) {
          const hours = whoopByDate.get(date)?.sleep?.totalSleepHours;
          if (hours != null) sleepByDate.set(date, hours);
        }
        const lastSevenNights = [...sleepByDate.keys()].slice(-7);
        const nightsOnTarget = lastSevenNights.filter(
          (date) => goals.sleepHours != null && (sleepByDate.get(date) ?? 0) >= goals.sleepHours
        ).length;

        const currentFtp = (settingsBody?.settings?.ftpWatts as number | undefined) ?? null;

        // Weight is held in kg throughout — the readings are converted on the
        // way in from Apple Health, and the goal is stored in kg by the editor.
        // Both are converted once here into whatever the user reads in, so the
        // chart, the figures and the unit beside them cannot disagree. The
        // previous label came from Apple Health's own unit while the numbers
        // were already metric, which would have read as lb on a kg figure.
        const inDisplayUnits = (kg: number | null) => (kg == null ? null : convertValueUnit(kg, "kg", system).value);
        const displayWeightUnit = convertValueUnit(1, "kg", system).unit;

        const datedGoals = {
          weight: {
            label: "Weight",
            unit: displayWeightUnit,
            current: inDisplayUnits(lastRecorded(weightByDate)),
            target: inDisplayUnits(goals.weightKg ?? null),
            targetDate: goals.weightTargetDate,
            start: inDisplayUnits(firstRecorded(weightByDate)),
            direction: "down",
          },
          ftp: {
            label: "FTP",
            unit: "W",
            // The current figure is the one entered in Settings rather than
            // anything derived from rides: FTP is a tested number, and
            // inferring it from ride power would move the goalposts every
            // time a hard effort was logged.
            current: currentFtp,
            target: goals.ftpTargetWatts ?? null,
            targetDate: goals.ftpTargetDate,
            start: currentFtp,
            direction: "up",
          },
          // The nightly target read over a week: how many of the last seven
          // nights cleared it. A weekly total was tried and is the wrong
          // shape — it hides four short nights behind one long lie-in, and
          // needs a second figure kept in step with the nightly one.
          sleepWeekly: {
            label: "Nights on target",
            unit: " of 7",
            current: lastSevenNights.length > 0 ? nightsOnTarget : null,
            target: goals.sleepHours != null ? 7 : null,
            start: 0,
            direction: "up",
          },
        } satisfies Record<string, DatedGoal>;

        setState({
          status: "ready",
          days,
          isTrainingDay,
          metrics,
          goals,
          saveGoals,
          whoopHistory: whoopDays,
          weightByDate,
          weightUnit,
          bmiByDate,
          performanceSeries,
          datedGoals,
          weightSeries: [...weightByDate.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, kg]) => ({ date, value: convertValueUnit(kg, "kg", system).value })),
        });
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
            whoopHistory: [],
            weightByDate: new Map(),
            weightUnit: "kg",
            bmiByDate: new Map(),
            performanceSeries: [],
            // Everything unknown rather than zeroed: a goal view showing 0kg
            // against a target reads as a real reading, and a failed fetch is
            // not a measurement.
            weightSeries: [],
            datedGoals: {
              weight: { label: "Weight", unit: "kg", current: null, target: null, start: null, direction: "down" },
              ftp: { label: "FTP", unit: "W", current: null, target: null, start: null, direction: "up" },
              sleepWeekly: { label: "Sleep this week", unit: "h", current: null, target: null, start: null, direction: "up" },
            },
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  return useMemo<TrendsDataState>(() => {
    if (raw.status !== "ready") return raw;
    // weightByDate is always stored in canonical kg (see weightKg() above) -
    // convert to the athlete's display preference here, same as every other
    // metric via convertTrendMetric, so the Health Calendar's weight/unit
    // label always match rather than showing kg values under a stale
    // source-catalog unit label.
    const weightByDate = new Map(
      Array.from(raw.weightByDate.entries()).map(([date, kg]) => [date, convertValueUnit(kg, "kg", system).value]),
    );
    const weightUnit = convertValueUnit(1, "kg", system).unit;
    return {
      ...raw,
      metrics: raw.metrics.map((m) => convertTrendMetric(m, system)),
      weightByDate,
      weightUnit,
    };
  }, [raw, system]);
}
