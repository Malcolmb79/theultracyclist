import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSessionEmail } from "./_lib/session.js";
import { fetchStravaActivities, type Activity } from "./strava-activities.js";
import { fetchWhoopWorkouts, type WhoopWorkout } from "./whoop-data.js";
import { fetchCoachingSettings } from "./coaching-settings.js";
import { computeTss } from "./_lib/tss.js";
import { irelandDateStr } from "./_lib/timeContext.js";

/**
 * Everything the athlete actually did, from every source that saw it.
 *
 * Strava is filtered to bike rides everywhere else in this app, because
 * CTL/ATL/TSB is a cycling measure and folding a gym session into it would
 * move the athlete's fitness numbers without them asking. This endpoint is the
 * deliberate exception: it keeps every sport, and adds the sessions Whoop
 * recorded that never reached Strava at all - a walk, a strength session,
 * anything the strap noticed without a head unit running.
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
  source: "strava" | "whoop";
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
  /** Set when Whoop also saw this session, so the list can say so. */
  alsoOnWhoop?: boolean;
};

/**
 * Two records of one session, or two sessions?
 *
 * A ride recorded on a head unit and picked up by the strap appears in both
 * feeds with slightly different start times and durations - Strava starts when
 * the ride does, Whoop when it decides the effort began. Matching on overlap
 * rather than equality is what stops every ride appearing twice, and the
 * window is deliberately tight: a genuine second session in the same half hour
 * is far rarer than a clock difference of a few minutes.
 */
const OVERLAP_TOLERANCE_MS = 30 * 60 * 1000;

function overlaps(strava: Activity, whoop: WhoopWorkout): boolean {
  const a = Date.parse(strava.startDate);
  const b = Date.parse(whoop.start);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= OVERLAP_TOLERANCE_MS;
}

export async function fetchAllActivities(count = 60): Promise<MergedActivity[]> {
  const [strava, whoop, settings] = await Promise.all([
    fetchStravaActivities(count).catch(() => [] as Activity[]),
    fetchWhoopWorkouts(45).catch(() => [] as WhoopWorkout[]),
    fetchCoachingSettings().catch(() => ({}) as { ftpWatts?: number }),
  ]);
  const ftp = (settings as { ftpWatts?: number }).ftpWatts;

  const matchedWhoop = new Set<string>();
  const merged: MergedActivity[] = strava.map((activity) => {
    const twin = whoop.find((w) => !matchedWhoop.has(w.id) && overlaps(activity, w));
    if (twin) matchedWhoop.add(twin.id);

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
      alsoOnWhoop: twin ? true : undefined,
    };
  });

  // Whatever Whoop saw that Strava never did.
  for (const workout of whoop) {
    if (matchedWhoop.has(workout.id)) continue;
    merged.push({
      id: `whoop:${workout.id}`,
      source: "whoop",
      sport: workout.sport,
      name: workout.sport,
      date: irelandDateStr(new Date(workout.start)),
      startDate: workout.start,
      durationMinutes: workout.durationMinutes,
      distanceKm: null,
      elevationGainM: null,
      avgWatts: null,
      avgHeartrate: null,
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
