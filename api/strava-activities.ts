import type { VercelRequest, VercelResponse } from "@vercel/node";

const TOKEN_URL = "https://www.strava.com/oauth/token";
const ACTIVITIES_URL = "https://www.strava.com/api/v3/athlete/activities";
const ATHLETE_URL = "https://www.strava.com/api/v3/athlete";
const RIDE_TYPES = new Set(["Ride", "GravelRide", "MountainBikeRide", "VirtualRide", "EBikeRide"]);
const RIDE_COUNT = 6;

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
  map?: { summary_polyline?: string };
  average_watts?: number;
  weighted_average_watts?: number;
  device_watts?: boolean;
  has_heartrate?: boolean;
  average_heartrate?: number;
  max_heartrate?: number;
  suffer_score?: number;
};

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
  elevationProfile: ElevationPoint[];
};

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const accessToken = await getAccessToken();
    const authHeader = { Authorization: `Bearer ${accessToken}` };

    const [activitiesRes, athleteRes] = await Promise.all([
      fetch(`${ACTIVITIES_URL}?per_page=15`, { headers: authHeader }),
      fetch(ATHLETE_URL, { headers: authHeader }),
    ]);

    if (!activitiesRes.ok) {
      throw new Error(`Strava activities fetch failed: ${activitiesRes.status}`);
    }
    if (!athleteRes.ok) {
      throw new Error(`Strava athlete fetch failed: ${athleteRes.status}`);
    }

    const activities = (await activitiesRes.json()) as StravaActivity[];
    const athleteData = (await athleteRes.json()) as StravaAthlete;

    const athlete: Athlete = {
      name: `${athleteData.firstname} ${athleteData.lastname}`.trim(),
      avatarUrl: athleteData.profile_medium ?? null,
      profileUrl: `https://www.strava.com/athletes/${athleteData.id}`,
    };

    const rideActivities = activities
      .filter((activity) => RIDE_TYPES.has(activity.sport_type || activity.type))
      .slice(0, RIDE_COUNT);

    const rides: Ride[] = await Promise.all(
      rideActivities.map(async (activity) => ({
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
        elevationProfile: await fetchElevationProfile(activity.id, authHeader),
      })),
    );

    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    res.status(200).json({ athlete, rides });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: "Unable to load Strava activities" });
  }
}
