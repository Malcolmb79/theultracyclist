export type UnitSystem = "metric" | "imperial";

const KM_TO_MI = 0.621371;
const M_TO_FT = 3.28084;
const KG_TO_LB = 2.20462;

// Converts a single (value, unit) pair to the target system. Units with no
// imperial/metric split (%, bpm, W, ms, h, min, kcal, g, mg, count, ...)
// pass through unchanged. No rounding here - render-time formatters handle
// that (e.g. DashboardWidget's formatValue).
export function convertValueUnit(
  value: number,
  unit: string,
  system: UnitSystem,
): { value: number; unit: string } {
  const u = unit.trim().toLowerCase();

  if (system === "imperial") {
    if (u === "km") return { value: value * KM_TO_MI, unit: "mi" };
    if (u === "m") return { value: value * M_TO_FT, unit: "ft" };
    if (u === "kg") return { value: value * KG_TO_LB, unit: "lb" };
    if (u === "km/h") return { value: value * KM_TO_MI, unit: "mph" };
    return { value, unit };
  }

  // system === "metric"
  if (u === "mi") return { value: value / KM_TO_MI, unit: "km" };
  if (u === "ft") return { value: value / M_TO_FT, unit: "m" };
  if (u === "lb") return { value: value / KG_TO_LB, unit: "kg" };
  if (u === "mi/hr" || u === "mph") return { value: value / KM_TO_MI, unit: "km/h" };
  return { value, unit };
}

interface SeriesMetric {
  unit: string;
  series: { date: string; value: number }[];
}

// Wraps a Dashboard MetricDef-shaped object (unit + precomputed series).
export function convertMetricSeries<T extends SeriesMetric>(metric: T, system: UnitSystem): T {
  const { unit: newUnit } = convertValueUnit(1, metric.unit, system);
  if (newUnit === metric.unit) return metric;
  return {
    ...metric,
    unit: newUnit,
    series: metric.series.map((p) => ({ ...p, value: convertValueUnit(p.value, metric.unit, system).value })),
  };
}

interface LazyMetric {
  unit: string;
  getValue: (date: string) => number | null;
  getGoal?: (date: string) => number | null;
}

// Wraps a Trends TrendMetricDef-shaped object (unit + lazy value/goal getters).
export function convertTrendMetric<T extends LazyMetric>(metric: T, system: UnitSystem): T {
  const { unit: newUnit } = convertValueUnit(1, metric.unit, system);
  if (newUnit === metric.unit) return metric;
  const sourceUnit = metric.unit;
  return {
    ...metric,
    unit: newUnit,
    getValue: (date) => {
      const v = metric.getValue(date);
      return v == null ? null : convertValueUnit(v, sourceUnit, system).value;
    },
    getGoal: metric.getGoal
      ? (date) => {
          const v = metric.getGoal!(date);
          return v == null ? null : convertValueUnit(v, sourceUnit, system).value;
        }
      : undefined,
  };
}
