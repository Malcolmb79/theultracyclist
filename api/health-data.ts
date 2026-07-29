import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getJSON, setJSON } from "./_lib/kvStore.js";
import { getSessionEmail } from "./_lib/session.js";
import { irelandDateStr } from "./_lib/timeContext.js";

// Active retention cap - the POST handler below trims stored history to the
// most recent MAX_DAYS on every ingest, permanently discarding older days.
// Raised from 90 to keep a full year available to the coach; the JSON is
// small so storage cost isn't a concern.
const MAX_DAYS = 365;

const KV_KEY = "APPLE_HEALTH_HISTORY";

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

// One-time migration fallback: this key used to live in a Vercel project
// env var, only visible to the running server after a full redeploy (see
// the git history for _lib/vercelEnvStore.ts) - since Apple Health syncs
// happen far more often than "low write frequency" assumed when every
// other route was migrated off this same mechanism, a sync could easily
// land while a previous sync's redeploy was still in flight, silently
// clobbering it (each write replaced the whole env var, and process.env is
// a build-time snapshot, so nothing was ever lost more visibly than "the
// dashboard just doesn't show it"). Until the first post-migration write
// lands in Redis, fall back to whatever's still in the env var so nothing
// synced before the cutover disappears.
function readLegacyHistory(): History {
  try {
    const raw = process.env.APPLE_HEALTH_HISTORY;
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as History) : {};
  } catch {
    return {};
  }
}

async function readHistory(): Promise<History> {
  return (await getJSON<History>(KV_KEY)) ?? readLegacyHistory();
}

// In-process accessor for the tool-calling coach: same stored history the
// GET route reads, filtered to a day window and optionally to specific
// metric names.
export async function fetchHealthHistory(days: number = MAX_DAYS, metricNames?: string[]): Promise<History> {
  const history = await readHistory();
  // Counted back from the Irish calendar day, since that's what the stored
  // date keys mean - a UTC cutoff trims a day early for the first hour of
  // every Irish day during BST.
  const cutoff = irelandDateStr(new Date(Date.now() - days * 86400000));

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
    const history = await readHistory();

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

    await setJSON(KV_KEY, trimmed);

    res.status(200).json({ ok: true, days: trimmedDates.length });
    return;
  }

  // Reads require a signed-in session. Unlike /api/strava-activities and
  // /api/whoop-data - which are deliberately open because the public site's
  // ride feed and recovery summary render from them - nothing outside the
  // signed-in dashboard reads this one, and it carries a year of body
  // weight, nutrition and body-composition history.
  //
  // The POST above keeps its own bearer-secret check instead: the iOS
  // Health Auto Export shortcut pushing data has no session cookie.
  if (!getSessionEmail(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const history = await readHistory();

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

  // Was cached at Vercel's edge for 30 minutes (stale-while-revalidate up
  // to an hour) - harmless back when writes needed a full redeploy to ever
  // change anyway, but now that writes are instant (see readHistory
  // above), a long public cache just reintroduces the same "synced but not
  // showing up" staleness from a different layer. KV reads are already
  // fast, so there's nothing worth caching here.
  res.status(200).json({ history, catalog });
}
