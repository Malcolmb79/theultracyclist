import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getJSON, readJSON, setJSON } from "../_lib/kvStore.js";
import { getSessionEmail } from "../_lib/session.js";

// Garmin's 3-minute stress and Body Battery readings for the last week,
// posted by scripts/garmin-sync.mjs. Kept apart from APPLE_HEALTH_HISTORY,
// which holds one number per metric per day for a year; this is ~500
// points a day and only the recent days are worth drawing.

const KV_KEY = "GARMIN_TIMELINE";
const MAX_DAYS = 7;

/** [timestamp ms, stress (-1 unmeasured, -2 active) or null, battery or null, 1 if battery estimated]. */
type Point = [number, number | null, number | null, 0 | 1];

export type TimelineDay = {
  date: string;
  /** Irish midnight at the start of `date`, ms. */
  dayStart: number;
  dayEnd: number;
  sleep: { start: number; end: number } | null;
  points: Point[];
  activities?: { start: number; end: number; name: string; type: string; load: number | null; calories: number | null }[];
};

type Timeline = Record<string, TimelineDay>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isDay(value: unknown): value is TimelineDay {
  const d = value as TimelineDay;
  return (
    !!d &&
    typeof d.date === "string" &&
    DATE.test(d.date) &&
    Number.isFinite(d.dayStart) &&
    Number.isFinite(d.dayEnd) &&
    Array.isArray(d.points) &&
    d.points.length <= 1000 &&
    (d.activities === undefined || (Array.isArray(d.activities) && d.activities.length <= 50))
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "POST") {
    // Same sender and secret as the health-data ingest.
    const secret = process.env.APPLE_HEALTH_WEBHOOK_SECRET;
    if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const days = (req.body as { days?: unknown[] } | undefined)?.days;
    if (!Array.isArray(days) || !days.every(isDay)) {
      res.status(400).json({ error: "Expected { days: TimelineDay[] }" });
      return;
    }

    let timeline: Timeline;
    try {
      timeline = (await readJSON<Timeline>(KV_KEY)) ?? {};
    } catch {
      res.status(503).json({ error: "Storage unavailable" });
      return;
    }
    for (const day of days) timeline[day.date] = day;
    const kept = Object.keys(timeline).sort().slice(-MAX_DAYS);
    const trimmed: Timeline = Object.fromEntries(kept.map((date) => [date, timeline[date]]));
    if (!(await setJSON(KV_KEY, trimmed))) {
      res.status(503).json({ error: "Storage unavailable" });
      return;
    }
    res.status(200).json({ ok: true, days: kept.length });
    return;
  }

  if (!getSessionEmail(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const timeline = (await getJSON<Timeline>(KV_KEY)) ?? {};
  res.status(200).json({ days: Object.keys(timeline).sort().map((date) => timeline[date]) });
}
