import type { VercelRequest, VercelResponse } from "@vercel/node";
import { waitUntil } from "@vercel/functions";
import { getJSON, setJSON } from "../_lib/kvStore.js";
import { getSessionEmail } from "../_lib/session.js";
import { trimPolylineEnds } from "../_lib/polylinePrivacy.js";

const TOKEN_URL = "https://www.strava.com/oauth/token";
const ACTIVITIES_URL = "https://www.strava.com/api/v3/athlete/activities";
const ATHLETE_URL = "https://www.strava.com/api/v3/athlete";
const RIDE_TYPES = new Set(["Ride", "GravelRide", "MountainBikeRide", "VirtualRide", "EBikeRide"]);
const RIDE_COUNT = 6;
const PER_PAGE = 200; // Strava's activities endpoint max page size.

type ElevationPoint = { distanceKm: number; altitudeM: number };

type StravaStreamSet = {
  distance?: { data: number[] };
  altitude?: { data: number[] };
};

async function fetchElevationProfile(activityId: number, authHeader: HeadersInit): Promise<ElevationPoint[]> {
  try {
    const url = `https://www.strava.com/api/v3/activities/${activityId}/streams?keys=distance,altitude&key_by_type=true&resolution=low`;
    const res = await fetch(url, { headers: authHeader });
    if (!res.ok) return [];

    const streams = (await res.json()) as StravaStreamSet;
    const distances = streams.distance?.data;
    const altitudes = streams.altitude?.data;
    if (!distances || !altitudes || distances.length < 2 || distances.length !== altitudes.length) {
      return [];
    }

    return distances.map((d, i) => ({
      distanceKm: Math.round((d / 1000) * 100) / 100,
      altitudeM: Math.round(altitudes[i]),
    }));
  } catch {
    return [];
  }
}

type StravaTokenResponse = {
  access_token: string;
  expires_at: number;
};

type StravaAthlete = {
  id: number;
  firstname: string;
  lastname: string;
  profile_medium?: string;
};

export type Athlete = {
  name: string;
  avatarUrl: string | null;
  profileUrl: string;
};

type StravaActivity = {
  id: number;
  name: string;
  distance: number;
  moving_time: number;
  type: string;
  sport_type: string;
  start_date: string;
  total_elevation_gain?: number;
  map?: { summary_polyline?: string };
  average_watts?: number;
  weighted_average_watts?: number;
  device_watts?: boolean;
  has_heartrate?: boolean;
  average_heartrate?: number;
  max_heartrate?: number;
  suffer_score?: number;
  /** For rides: 10 default, 11 race, 12 workout. */
  workout_type?: number | null;
};

export type PeriodSummary = {
  rideCount: number;
  distanceKm: number;
  movingTimeMinutes: number;
  elevationGainM: number;
  avgWatts: number | null;
  avgHeartrate: number | null;
  totalRelativeEffort: number | null;
};

function summarizePeriod(rides: StravaActivity[]): PeriodSummary {
  const totalMovingTime = rides.reduce((sum, r) => sum + r.moving_time, 0);

  const powerRides = rides.filter((r) => r.device_watts && r.average_watts != null);
  const powerTime = powerRides.reduce((sum, r) => sum + r.moving_time, 0);
  const avgWatts = powerTime > 0
    ? Math.round(powerRides.reduce((sum, r) => sum + (r.average_watts ?? 0) * r.moving_time, 0) / powerTime)
    : null;

  const hrRides = rides.filter((r) => r.has_heartrate && r.average_heartrate != null);
  const hrTime = hrRides.reduce((sum, r) => sum + r.moving_time, 0);
  const avgHeartrate = hrTime > 0
    ? Math.round(hrRides.reduce((sum, r) => sum + (r.average_heartrate ?? 0) * r.moving_time, 0) / hrTime)
    : null;

  const effortRides = rides.filter((r) => r.suffer_score != null);
  const totalRelativeEffort = effortRides.length > 0
    ? Math.round(effortRides.reduce((sum, r) => sum + (r.suffer_score ?? 0), 0))
    : null;

  return {
    rideCount: rides.length,
    distanceKm: Math.round(rides.reduce((sum, r) => sum + r.distance, 0) / 100) / 10,
    movingTimeMinutes: Math.round(totalMovingTime / 60),
    elevationGainM: Math.round(rides.reduce((sum, r) => sum + (r.total_elevation_gain ?? 0), 0)),
    avgWatts,
    avgHeartrate,
    totalRelativeEffort,
  };
}

export type Ride = {
  id: number;
  name: string;
  distanceKm: number;
  movingTimeMinutes: number;
  startDate: string;
  url: string;
  polyline: string;
  avgWatts: number | null;
  weightedAvgWatts: number | null;
  avgHeartrate: number | null;
  maxHeartrate: number | null;
  relativeEffort: number | null;
  /** Strava's own total for the ride - always present, unlike the profile. */
  elevationGainM: number;
  /** Marked as a race in Strava. */
  race?: boolean;
  /**
   * Only populated for the first `profileCount` rides (see fetchStravaRides).
   * Empty is normal for older rides, not an error.
   */
  elevationProfile: ElevationPoint[];
};

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

// Exported so api/_routes/strava-photos.ts reuses this exact refresh path (and its
// in-lambda token cache) instead of keeping a second copy of the credential
// handling.
export async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - 60 > Date.now() / 1000) {
    return cachedToken.accessToken;
  }

  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  const refreshToken = process.env.STRAVA_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Strava API credentials are not configured");
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    throw new Error(`Strava token refresh failed: ${response.status}`);
  }

  const data = (await response.json()) as StravaTokenResponse;
  cachedToken = { accessToken: data.access_token, expiresAt: data.expires_at };
  return cachedToken.accessToken;
}

// Strava's activities endpoint paginates via `page`/`per_page` (max 200 per
// page); walk pages until enough ride-type activities are collected or the
// account runs out of history.
async function fetchRideActivities(authHeader: HeadersInit, count: number): Promise<StravaActivity[]> {
  const rides: StravaActivity[] = [];
  let page = 1;

  while (rides.length < count) {
    const res = await fetch(`${ACTIVITIES_URL}?per_page=${PER_PAGE}&page=${page}`, { headers: authHeader });
    if (!res.ok) throw new Error(`Strava activities fetch failed: ${res.status}`);

    const activities = (await res.json()) as StravaActivity[];
    if (activities.length === 0) break;

    rides.push(...activities.filter((a) => RIDE_TYPES.has(a.sport_type || a.type)));
    if (activities.length < PER_PAGE) break;
    page += 1;
  }

  return rides.slice(0, count);
}

/**
 * Every activity, not just the bike ones.
 *
 * fetchStravaRides deliberately keeps only RIDE_TYPES, because CTL/ATL/TSB
 * here is a cycling measure and quietly folding a gym session into it would
 * move the athlete's fitness numbers without them asking. The all-activity
 * widget needs the opposite - runs, walks, swims, strength, everything - so it
 * gets its own reader rather than a flag on that one, keeping the two uses
 * impossible to confuse.
 */
export type Activity = {
  id: number;
  name: string;
  sport: string;
  startDate: string;
  movingTimeMinutes: number;
  distanceKm: number | null;
  elevationGainM: number | null;
  avgWatts: number | null;
  avgHeartrate: number | null;
  isRide: boolean;
};

export async function fetchStravaActivities(count = 60): Promise<Activity[]> {
  const accessToken = await getAccessToken();
  const authHeader = { Authorization: `Bearer ${accessToken}` };

  const collected: StravaActivity[] = [];
  let page = 1;
  while (collected.length < count) {
    const res = await fetch(`${ACTIVITIES_URL}?per_page=${PER_PAGE}&page=${page}`, { headers: authHeader });
    if (!res.ok) throw new Error(`Strava activities fetch failed: ${res.status}`);
    const activities = (await res.json()) as StravaActivity[];
    if (activities.length === 0) break;
    collected.push(...activities);
    if (activities.length < PER_PAGE) break;
    page += 1;
  }

  return collected.slice(0, count).map((a) => {
    const sport = a.sport_type || a.type;
    return {
      id: a.id,
      name: a.name,
      sport,
      startDate: a.start_date,
      movingTimeMinutes: Math.round(a.moving_time / 60),
      // A gym session has no distance worth showing; zero would read as a
      // measurement rather than an absence.
      distanceKm: a.distance > 0 ? Math.round((a.distance / 1000) * 100) / 100 : null,
      elevationGainM: a.total_elevation_gain != null && a.total_elevation_gain > 0 ? Math.round(a.total_elevation_gain) : null,
      avgWatts: a.average_watts ?? null,
      avgHeartrate: a.average_heartrate ?? null,
      isRide: RIDE_TYPES.has(sport),
    };
  });
}

/**
 * `profileCount` caps how many rides get an elevation *profile*, which is a
 * separate Strava streams call per ride.
 *
 * That matters a lot: the dashboard asks for 200 rides (for CTL/ATL/TSB
 * history), and fetching a profile for each meant 200 extra API calls on every
 * page load - about seven seconds, and far past Strava's 100-per-15-minutes
 * limit, so most of them came back 429 and were swallowed as an empty profile.
 * Only the public ride feed actually draws the trace, and it shows the default
 * handful, so profiles stop at this many and the rest ship without one.
 */
export async function fetchStravaRides(count: number = RIDE_COUNT, profileCount: number = RIDE_COUNT): Promise<Ride[]> {
  const accessToken = await getAccessToken();
  const authHeader = { Authorization: `Bearer ${accessToken}` };

  const rideActivities = await fetchRideActivities(authHeader, count);

  return Promise.all(
    rideActivities.map(async (activity, index) => ({
      id: activity.id,
      name: activity.name,
      distanceKm: Math.round((activity.distance / 1000) * 10) / 10,
      movingTimeMinutes: Math.round(activity.moving_time / 60),
      startDate: activity.start_date,
      url: `https://www.strava.com/activities/${activity.id}`,
      polyline: activity.map?.summary_polyline ?? "",
      avgWatts: activity.device_watts ? Math.round(activity.average_watts ?? 0) : null,
      weightedAvgWatts: activity.device_watts && activity.weighted_average_watts != null
        ? Math.round(activity.weighted_average_watts)
        : null,
      avgHeartrate: activity.has_heartrate && activity.average_heartrate != null
        ? Math.round(activity.average_heartrate)
        : null,
      maxHeartrate: activity.has_heartrate && activity.max_heartrate != null
        ? Math.round(activity.max_heartrate)
        : null,
      relativeEffort: activity.suffer_score != null ? Math.round(activity.suffer_score) : null,
      // Strava's own per-ride total, so the elevation-gain metric no longer
      // depends on a streams call that mostly failed at this volume.
      elevationGainM: Math.round(activity.total_elevation_gain ?? 0),
      race: activity.workout_type === 11 || undefined,
      elevationProfile: index < profileCount ? await fetchElevationProfile(activity.id, authHeader) : [],
    })),
  );
}

export type StravaPayload = { athlete: Athlete; rides: Ride[]; summary: { weekly: PeriodSummary; monthly: PeriodSummary } };

async function buildStravaPayload(count: number): Promise<StravaPayload> {
  const rides = await fetchStravaRides(count);

  const accessToken = await getAccessToken();
  const authHeader = { Authorization: `Bearer ${accessToken}` };

  const nowMs = Date.now();
  const weekAgoMs = nowMs - 7 * 24 * 60 * 60 * 1000;
  const monthAgoMs = nowMs - 30 * 24 * 60 * 60 * 1000;
  const monthAgoEpoch = Math.floor(monthAgoMs / 1000);

  const [monthActivitiesRes, athleteRes] = await Promise.all([
    fetch(`${ACTIVITIES_URL}?after=${monthAgoEpoch}&per_page=100`, { headers: authHeader }),
    fetch(ATHLETE_URL, { headers: authHeader }),
  ]);

  if (!monthActivitiesRes.ok) {
    throw new Error(`Strava month activities fetch failed: ${monthActivitiesRes.status}`);
  }
  if (!athleteRes.ok) {
    throw new Error(`Strava athlete fetch failed: ${athleteRes.status}`);
  }

  const monthActivities = (await monthActivitiesRes.json()) as StravaActivity[];
  const athleteData = (await athleteRes.json()) as StravaAthlete;

  const monthRides = monthActivities.filter((a) => RIDE_TYPES.has(a.sport_type || a.type));
  const weekRides = monthRides.filter((a) => new Date(a.start_date).getTime() >= weekAgoMs);

  const summary = {
    weekly: summarizePeriod(weekRides),
    monthly: summarizePeriod(monthRides),
  };

  const athlete: Athlete = {
    name: `${athleteData.firstname} ${athleteData.lastname}`.trim(),
    avatarUrl: athleteData.profile_medium ?? null,
    profileUrl: `https://www.strava.com/athletes/${athleteData.id}`,
  };

  return { athlete, rides, summary };
}

// The public site shows the latest few rides. More than that - the whole
// history, with every route and heart-rate trace - is for the signed-in
// dashboard only, and is never cached where anyone else could be served it.
const MAX_PRIVATE_COUNT = 400;
const HISTORY_CACHE_KEY = "STRAVA_HISTORY_CACHE";
// Fresh enough to serve as is; past this a stale copy is still served at once
// and refreshed behind the response, the way the edge cache used to do it.
const HISTORY_FRESH_MS = 15 * 60 * 1000;
const HISTORY_STALE_MS = 24 * 60 * 60 * 1000;

type CachedHistory = { fetchedAt: number; count: number; payload: StravaPayload };

// The last public list that loaded, served when Strava refuses - a rate limit
// otherwise takes the Follow page's rides down until it lifts.
const PUBLIC_CACHE_KEY = "STRAVA_PUBLIC_CACHE";

/** Fetches the dashboard's ride history afresh and stores it. Also run by the daily cron. */
export async function refreshStravaHistoryCache(count = 200): Promise<StravaPayload> {
  const payload = await buildStravaPayload(count);
  await setJSON(HISTORY_CACHE_KEY, { fetchedAt: Date.now(), count, payload } satisfies CachedHistory);
  return payload;
}

async function privateHistory(count: number): Promise<StravaPayload> {
  const cached = await getJSON<CachedHistory>(HISTORY_CACHE_KEY);
  const age = cached ? Date.now() - cached.fetchedAt : Infinity;
  if (cached && cached.count >= count && age < HISTORY_STALE_MS) {
    if (age >= HISTORY_FRESH_MS) waitUntil(refreshStravaHistoryCache(cached.count).catch((error) => console.error(error)));
    return { ...cached.payload, rides: cached.payload.rides.slice(0, count) };
  }
  try {
    return await refreshStravaHistoryCache(Math.max(count, cached?.count ?? 0));
  } catch (error) {
    // Strava down or rate limited: an old history beats none.
    if (!cached) throw error;
    console.error("Strava history refresh failed; serving the stored copy", error);
    return { ...cached.payload, rides: cached.payload.rides.slice(0, count) };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestedCount = Number(req.query.count);
  const count = Number.isFinite(requestedCount) && requestedCount > 0 ? Math.floor(requestedCount) : RIDE_COUNT;

  try {
    if (count > RIDE_COUNT) {
      if (!getSessionEmail(req)) {
        res.status(401).json({ error: `Sign in to see more than the latest ${RIDE_COUNT} rides` });
        return;
      }
      const payload = await privateHistory(Math.min(count, MAX_PRIVATE_COUNT));
      res.setHeader("Cache-Control", "private, no-store");
      res.status(200).json(payload);
      return;
    }

    const payload = await buildStravaPayload(count);
    const rides = payload.rides.map((ride) => ({ ...ride, polyline: trimPolylineEnds(ride.polyline) }));

    // Ride history barely changes, and a cold response costs seconds upstream.
    // The long stale-while-revalidate window is what matters: a stale copy is
    // served instantly and refreshed behind the request, so only a first load
    // in 24h ever waits. Safe to share: this is the public few-ride list, with
    // each route's start and finish cut off.
    const body = { ...payload, rides };
    await setJSON(PUBLIC_CACHE_KEY, body);
    res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=86400");
    res.status(200).json(body);
  } catch (error) {
    console.error(error);
    const lastGood = count <= RIDE_COUNT ? await getJSON<StravaPayload>(PUBLIC_CACHE_KEY) : null;
    if (lastGood) {
      // Cached briefly, so the edge asks again soon once Strava recovers.
      res.setHeader("Cache-Control", "public, s-maxage=60");
      res.status(200).json(lastGood);
      return;
    }
    res.status(502).json({ error: "Unable to load Strava activities" });
  }
}
