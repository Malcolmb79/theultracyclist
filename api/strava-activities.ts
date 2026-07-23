import type { VercelRequest, VercelResponse } from "@vercel/node";

const TOKEN_URL = "https://www.strava.com/oauth/token";
const ACTIVITIES_URL = "https://www.strava.com/api/v3/athlete/activities";
const RIDE_TYPES = new Set(["Ride", "GravelRide", "MountainBikeRide", "VirtualRide", "EBikeRide"]);
const RIDE_COUNT = 6;

type StravaTokenResponse = {
  access_token: string;
  expires_at: number;
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
};

export type Ride = {
  id: number;
  name: string;
  distanceKm: number;
  movingTimeMinutes: number;
  startDate: string;
  url: string;
  polyline: string;
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

    const activitiesRes = await fetch(`${ACTIVITIES_URL}?per_page=15`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!activitiesRes.ok) {
      throw new Error(`Strava activities fetch failed: ${activitiesRes.status}`);
    }

    const activities = (await activitiesRes.json()) as StravaActivity[];

    const rides: Ride[] = activities
      .filter((activity) => RIDE_TYPES.has(activity.sport_type || activity.type))
      .slice(0, RIDE_COUNT)
      .map((activity) => ({
        id: activity.id,
        name: activity.name,
        distanceKm: Math.round((activity.distance / 1000) * 10) / 10,
        movingTimeMinutes: Math.round(activity.moving_time / 60),
        startDate: activity.start_date,
        url: `https://www.strava.com/activities/${activity.id}`,
        polyline: activity.map?.summary_polyline ?? "",
      }));

    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    res.status(200).json({ rides });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: "Unable to load Strava activities" });
  }
}
