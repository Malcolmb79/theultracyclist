import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSessionEmail } from "../_lib/session.js";
import { fetchStravaActivities, type Activity } from "./strava-activities.js";
import { fetchGarminActivities, type GarminActivity } from "./garmin-activities.js";
import { fetchCoachingSettings } from "./coaching-settings.js";
import { computeTss } from "../_lib/tss.js";
import { irelandDateStr } from "../_lib/timeContext.js";

/**
 * Everything the athlete actually did, from every source that saw it.
 *
 * Strava is filtered to bike rides everywhere else in this app, because
 * CTL/ATL/TSB is a cycling measure and folding a gym session into it would
 * move the athlete's fitness numbers without them asking. This endpoint is the
 * deliberate exception: it keeps every sport, and adds the sessions the
 * Garmin watch recorded that never reached Strava at all - a walk, a strength
 * session, anything logged on the watch alone.
 *
 * TSS is still only attached to rides with power, for the same reason. The
 * list shows everything; the fitness maths stays as it was.
 *
 * Apple Health is not a source here. This app's health ingest stores day-level
 * metrics (steps, energy, weight), not workout records, so there is nothing
 * activity-shaped in it to merge.
 */

export type MergedActivity = {
  id: string;
  source: "strava" | "garmin";
  sport: string;
  name: string;
  /** Irish calendar date, so it groups the same way everything else does. */
  date: string;
  startDate: string;
  durationMinutes: number | null;
  distanceKm: number | null;
  elevationGainM: number | null;
  avgWatts: number | null;
  avgHeartrate: number | null;
  /** Only ever set for rides with power - see the note above. */
  tss: number | null;
  /** Set when Garmin also recorded this session, so the list can say so. */
  alsoOnGarmin?: boolean;
};

/**
 * Two records of one session, or two sessions?
 *
 * A ride recorded on the watch and synced on to Strava appears in both feeds,
 * sometimes with slightly different start times - an upload trimmed or merged
 * on Strava, or one recorded on a head unit while the watch logged it too.
 * Matching on overlap
 * rather than equality is what stops every ride appearing twice, and the
 * window is deliberately tight: a genuine second session in the same half hour
 * is far rarer than a clock difference of a few minutes.
 */
const OVERLAP_TOLERANCE_MS = 30 * 60 * 1000;

function overlaps(strava: Activity, garmin: GarminActivity): boolean {
  const a = Date.parse(strava.startDate);
  const b = Date.parse(garmin.start);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= OVERLAP_TOLERANCE_MS;
}

export async function fetchAllActivities(count = 60): Promise<MergedActivity[]> {
  const [strava, garmin, settings] = await Promise.all([
    fetchStravaActivities(count).catch(() => [] as Activity[]),
    fetchGarminActivities().catch(() => [] as GarminActivity[]),
    fetchCoachingSettings().catch(() => ({}) as { ftpWatts?: number }),
  ]);
  const ftp = (settings as { ftpWatts?: number }).ftpWatts;

  // Only as far back as the Strava list reaches, so an old watch session isn't
  // listed as unmatched just because its Strava twin is past the count.
  const oldestStrava = strava.reduce((min, a) => (a.startDate < min ? a.startDate : min), new Date().toISOString());
  const recentGarmin = strava.length > 0 ? garmin.filter((g) => g.start >= oldestStrava) : garmin.slice(0, count);

  const matchedGarmin = new Set<string>();
  const merged: MergedActivity[] = strava.map((activity) => {
    const twin = recentGarmin.find((g) => !matchedGarmin.has(g.id) && overlaps(activity, g));
    if (twin) matchedGarmin.add(twin.id);

    return {
      id: `strava:${activity.id}`,
      source: "strava",
      sport: activity.sport,
      name: activity.name,
      date: irelandDateStr(new Date(activity.startDate)),
      startDate: activity.startDate,
      durationMinutes: activity.movingTimeMinutes,
      distanceKm: activity.distanceKm,
      elevationGainM: activity.elevationGainM,
      avgWatts: activity.avgWatts,
      avgHeartrate: activity.avgHeartrate,
      // Rides only, and only with power behind them - the same rule the
      // performance chart uses, so a number here always means the same thing
      // as a number there.
      tss: activity.isRide ? computeTss(activity.avgWatts, activity.movingTimeMinutes, ftp) : null,
      alsoOnGarmin: twin ? true : undefined,
    };
  });

  // Whatever the watch recorded that Strava never got.
  for (const activity of recentGarmin) {
    if (matchedGarmin.has(activity.id)) continue;
    merged.push({
      id: `garmin:${activity.id}`,
      source: "garmin",
      sport: activity.type.replace(/_/g, " "),
      name: activity.name,
      date: irelandDateStr(new Date(activity.start)),
      startDate: activity.start,
      durationMinutes: activity.durationMinutes,
      distanceKm: activity.distanceKm,
      elevationGainM: activity.elevationGainM,
      avgWatts: activity.avgWatts,
      avgHeartrate: activity.avgHeartrate,
      // No TSS: the same rule as above, and Garmin's training load is not TSS.
      tss: null,
    });
  }

  return merged.sort((a, b) => b.startDate.localeCompare(a.startDate));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!getSessionEmail(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const count = Math.min(Number(req.query.count) || 60, 200);
  try {
    const activities = await fetchAllActivities(count);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.status(200).json({ activities });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: "Unable to load activities" });
  }
}
