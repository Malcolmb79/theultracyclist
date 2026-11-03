import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyRaceCors, getRaceAuthEmail } from "../_lib/raceToken.js";
import { getJSON, setJSON } from "../_lib/kvStore.js";
import { fetchStravaRides } from "./strava-activities.js";

/**
 * The rider's max heart rate over the last 90 days, from their Strava rides,
 * for the mod's heart-rate zone colours. A strap's one-off spike shouldn't
 * set the zones, so a top reading well clear of every other ride's is
 * passed over for the next. Kept for 12 hours.
 *
 * GET, with the race key. Answers { maxHr, rides, from } or { maxHr: null }.
 */

const CACHE_KEY = "strava:max-hr-90d";
const CACHE_MS = 12 * 60 * 60 * 1000;
const DAYS = 90;
/** A ride's max this far above every other ride's is taken for a glitch. */
const SPIKE_BPM = 8;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyRaceCors(req, (name, value) => res.setHeader(name, value));
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (!getRaceAuthEmail(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  const cached = await getJSON<{ at: number; value: unknown }>(CACHE_KEY);
  if (cached && Date.now() - cached.at < CACHE_MS) {
    res.status(200).json(cached.value);
    return;
  }
  try {
    const since = Date.now() - DAYS * 86_400_000;
    const rides = (await fetchStravaRides(200, 0)).filter((r) => Date.parse(r.startDate) >= since && r.maxHeartrate != null);
    const maxes = rides.map((r) => r.maxHeartrate as number).filter((v) => v > 100 && v < 225).sort((a, b) => b - a);
    const maxHr = maxes.length > 1 && maxes[0] - maxes[1] > SPIKE_BPM ? maxes[1] : (maxes[0] ?? null);
    const value = { maxHr, rides: maxes.length, days: DAYS };
    await setJSON(CACHE_KEY, { at: Date.now(), value });
    res.status(200).json(value);
  } catch (e) {
    res.status(200).json({ maxHr: null, error: e instanceof Error ? e.message : "Failed" });
  }
}
