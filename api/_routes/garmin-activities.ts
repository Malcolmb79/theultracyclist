import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getJSON, readJSON, setJSON } from "../_lib/kvStore.js";

// Recent Garmin Connect activities, posted by scripts/garmin-sync.mjs, so the
// All activity feed can list sessions the watch recorded that never reached
// Strava. Merged by activity id and capped, newest kept.

const KV_KEY = "GARMIN_ACTIVITIES";
const MAX_ACTIVITIES = 400;

export type GarminActivity = {
  id: string;
  /** ISO start time, UTC. */
  start: string;
  name: string;
  /** Garmin's activity type key, e.g. "road_biking", "walking". */
  type: string;
  durationMinutes: number | null;
  distanceKm: number | null;
  elevationGainM: number | null;
  avgHeartrate: number | null;
  avgWatts: number | null;
  trainingLoad: number | null;
  calories: number | null;
};

function isActivity(value: unknown): value is GarminActivity {
  const a = value as GarminActivity;
  return !!a && typeof a.id === "string" && typeof a.start === "string" && Number.isFinite(Date.parse(a.start)) && typeof a.name === "string";
}

export async function fetchGarminActivities(): Promise<GarminActivity[]> {
  const stored = (await getJSON<Record<string, GarminActivity>>(KV_KEY)) ?? {};
  return Object.values(stored).sort((a, b) => b.start.localeCompare(a.start));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  // Same sender and secret as the health-data ingest.
  const secret = process.env.APPLE_HEALTH_WEBHOOK_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const incoming = (req.body as { activities?: unknown[] } | undefined)?.activities;
  if (!Array.isArray(incoming) || incoming.length > 500 || !incoming.every(isActivity)) {
    res.status(400).json({ error: "Expected { activities: GarminActivity[] }" });
    return;
  }

  let stored: Record<string, GarminActivity>;
  try {
    stored = (await readJSON<Record<string, GarminActivity>>(KV_KEY)) ?? {};
  } catch {
    res.status(503).json({ error: "Storage unavailable" });
    return;
  }
  for (const activity of incoming) stored[activity.id] = activity;
  const kept = Object.values(stored)
    .sort((a, b) => b.start.localeCompare(a.start))
    .slice(0, MAX_ACTIVITIES);
  if (!(await setJSON(KV_KEY, Object.fromEntries(kept.map((a) => [a.id, a]))))) {
    res.status(503).json({ error: "Storage unavailable" });
    return;
  }
  res.status(200).json({ ok: true, activities: kept.length });
}
