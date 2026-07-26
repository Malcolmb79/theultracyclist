import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSessionEmail } from "./_lib/session.js";
import { fetchCoachingSettings } from "./coaching-settings.js";

export type LiveTrackPoint = {
  lat: number;
  lon: number;
  timestamp: number;
  distanceKm: number | null;
  elevationM: number | null;
  speedKmh: number | null;
};

export type LiveTrackResult =
  | { status: "notConfigured" }
  | { status: "invalidUrl" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      sessionStatus: "InProgress" | "Expired" | "unknown";
      sessionName: string | null;
      points: LiveTrackPoint[];
    };

// Parses a pasted LiveTrack share URL, e.g.
// https://livetrack.garmin.com/session/{sessionId}/token/{token} - into the
// two identifiers the unofficial services/ API below needs. Garmin
// generates a fresh session URL every time LiveTrack is started on the
// device - there's no persistent account-level connection to store, so this
// always comes from whatever the athlete last pasted into Settings.
function parseSessionUrl(url: string): { sessionId: string; token: string } | null {
  const match = url.match(/session\/([a-f0-9-]{20,})\/token\/([A-Za-z0-9]+)/i);
  if (!match) return null;
  return { sessionId: match[1], token: match[2] };
}

// Garmin has no public/documented LiveTrack API - these endpoints and their
// response shape are reverse-engineered by the community (see
// github.com/renarsvilnis/garmin-livetrack), not confirmed against a real
// active session by this codebase. The exact field names/units (assumed
// meters and m/s, Garmin's usual raw device units) are a best effort and
// may need correcting once there's a live session to test against.
async function fetchSession(sessionId: string, token: string): Promise<{ sessionName?: string; sessionStatus?: string }> {
  const url = `https://livetrack.garmin.com/services/session/${sessionId}/token/${token}?requestTime=${Date.now()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`LiveTrack session request failed (${res.status})`);
  return (await res.json()) as { sessionName?: string; sessionStatus?: string };
}

async function fetchTrackLog(sessionId: string, token: string) {
  const url = `https://livetrack.garmin.com/services/trackLog/${sessionId}/token/${token}?requestTime=${Date.now()}&from=0`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`LiveTrack track log request failed (${res.status})`);
  const raw = (await res.json()) as unknown;
  const list = Array.isArray(raw) ? raw : ((raw as { trackPoints?: unknown[] })?.trackPoints ?? []);
  return list as Array<{
    latitude: number;
    longitude: number;
    timestamp: number;
    metaData?: { TOTAL_DISTANCE?: string; ELEVATION?: string; SPEED?: string };
  }>;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!getSessionEmail(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const settings = await fetchCoachingSettings();
  if (!settings.garminLiveTrackUrl) {
    res.status(200).json({ status: "notConfigured" } satisfies LiveTrackResult);
    return;
  }

  const parsed = parseSessionUrl(settings.garminLiveTrackUrl);
  if (!parsed) {
    res.status(200).json({ status: "invalidUrl" } satisfies LiveTrackResult);
    return;
  }

  try {
    const [session, trackPoints] = await Promise.all([
      fetchSession(parsed.sessionId, parsed.token),
      fetchTrackLog(parsed.sessionId, parsed.token),
    ]);

    const points: LiveTrackPoint[] = trackPoints
      .filter((p) => typeof p.latitude === "number" && typeof p.longitude === "number")
      .map((p) => ({
        lat: p.latitude,
        lon: p.longitude,
        timestamp: p.timestamp,
        distanceKm: p.metaData?.TOTAL_DISTANCE ? Number(p.metaData.TOTAL_DISTANCE) / 1000 : null,
        elevationM: p.metaData?.ELEVATION ? Number(p.metaData.ELEVATION) : null,
        speedKmh: p.metaData?.SPEED ? Number(p.metaData.SPEED) * 3.6 : null,
      }));

    const result: LiveTrackResult = {
      status: "ready",
      sessionStatus:
        session.sessionStatus === "InProgress" || session.sessionStatus === "Expired" ? session.sessionStatus : "unknown",
      sessionName: session.sessionName ?? null,
      points,
    };
    res.status(200).json(result);
  } catch (error) {
    const result: LiveTrackResult = {
      status: "error",
      message: error instanceof Error ? error.message : "LiveTrack request failed",
    };
    res.status(200).json(result);
  }
}
