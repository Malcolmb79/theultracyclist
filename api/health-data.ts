import type { VercelRequest, VercelResponse } from "@vercel/node";
import { persistEnvVar, triggerDeployHook } from "./_lib/vercelEnvStore.js";

// Active retention cap - the POST handler below trims stored history to the
// most recent MAX_DAYS on every ingest, permanently discarding older days.
// Raised from 90 to keep a full year available to the coach; the JSON is
// small so storage cost isn't a concern.
const MAX_DAYS = 365;

// Units that represent a cumulative daily total get summed across same-day
// samples (steps, calories, minutes, grams of a nutrient); anything else
// (weight, heart rate, percentages, VO2 max) is a point-in-time reading and
// gets averaged across the day's samples instead.
const SUM_UNITS = new Set(["kcal", "count", "min", "g", "mg", "km", "mi", "IU", "mcg"]);

export type MetricValue = { value: number; unit: string };
export type DayMetrics = Record<string, MetricValue>;
export type History = Record<string, DayMetrics>;

type HealthAutoExportPayload = {
  data?: {
    metrics?: {
      name: string;
      units: string;
      data: { qty?: number; date: string; source?: string }[];
    }[];
  };
};

function readHistory(): History {
  try {
    const raw = process.env.APPLE_HEALTH_HISTORY;
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as History) : {};
  } catch {
    return {};
  }
}

// In-process accessor for the tool-calling coach: same stored history the
// GET route reads, filtered to a day window and optionally to specific
// metric names.
export function fetchHealthHistory(days: number = MAX_DAYS, metricNames?: string[]): History {
  const history = readHistory();
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  const filtered: History = {};
  for (const [date, metrics] of Object.entries(history)) {
    if (date < cutoff) continue;

    if (!metricNames || metricNames.length === 0) {
      filtered[date] = metrics;
      continue;
    }

    const subset: DayMetrics = {};
    for (const name of metricNames) {
      if (metrics[name]) subset[name] = metrics[name];
    }
    if (Object.keys(subset).length > 0) filtered[date] = subset;
  }

  return filtered;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "POST") {
    const secret = process.env.APPLE_HEALTH_WEBHOOK_SECRET;
    const authHeader = req.headers.authorization;
    if (!secret || authHeader !== `Bearer ${secret}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const payload = req.body as HealthAutoExportPayload;
    const metrics = payload.data?.metrics ?? [];
    const history = readHistory();

    for (const metric of metrics) {
      const isSum = SUM_UNITS.has(metric.units);
      const byDate = new Map<string, number[]>();

      for (const point of metric.data) {
        if (typeof point.qty !== "number" || typeof point.date !== "string") continue;
        const date = point.date.slice(0, 10);
        const list = byDate.get(date) ?? [];
        list.push(point.qty);
        byDate.set(date, list);
      }

      for (const [date, values] of byDate) {
        const total = values.reduce((sum, v) => sum + v, 0);
        const aggregated = isSum ? total : total / values.length;
        history[date] = history[date] ?? {};
        history[date][metric.name] = { value: Math.round(aggregated * 100) / 100, unit: metric.units };
      }
    }

    const trimmedDates = Object.keys(history)
      .sort((a, b) => (a < b ? 1 : -1))
      .slice(0, MAX_DAYS);
    const trimmed: History = {};
    for (const date of trimmedDates) trimmed[date] = history[date];

    await persistEnvVar("APPLE_HEALTH_HISTORY", JSON.stringify(trimmed));
    await triggerDeployHook();

    res.status(200).json({ ok: true, days: trimmedDates.length });
    return;
  }

  const history = readHistory();

  const catalogMap = new Map<string, { unit: string; days: number }>();
  for (const day of Object.values(history)) {
    for (const [name, metric] of Object.entries(day)) {
      const existing = catalogMap.get(name);
      if (existing) existing.days += 1;
      else catalogMap.set(name, { unit: metric.unit, days: 1 });
    }
  }
  const catalog = Array.from(catalogMap.entries())
    .map(([name, info]) => ({ name, unit: info.unit, days: info.days }))
    .sort((a, b) => a.name.localeCompare(b.name));

  res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=3600");
  res.status(200).json({ history, catalog });
}
