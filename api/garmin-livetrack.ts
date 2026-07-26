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
  | { status: "ready"; points: LiveTrackPoint[] };

// Parses a pasted LiveTrack share URL, e.g.
// https://livetrack.garmin.com/session/{sessionId}/token/{token} - into the
// two identifiers the endpoint below needs. Garmin generates a fresh
// session URL every time LiveTrack is started on the device - there's no
// persistent account-level connection to store, so this always comes from
// whatever the athlete last pasted into Settings.
function parseSessionUrl(url: string): { sessionId: string; token: string } | null {
  const match = url.match(/session\/([a-f0-9-]{20,})\/token\/([A-Za-z0-9]+)/i);
  if (!match) return null;
  return { sessionId: match[1], token: match[2] };
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

// Garmin has no public/documented LiveTrack API. Confirmed live against a
// real session (2026-07-26): the old community-reverse-engineered
// services/session + services/trackLog endpoints (a different, since-
// replaced version of LiveTrack) both 404 - the current site is a Next.js
// app whose own network traffic was inspected to find this endpoint. That
// session had zero recorded points, so the exact field names inside each
// point are still unconfirmed - extractPoint below tries several plausible
// key spellings rather than committing to one, and should be tightened up
// once there's a session with real points to check against.
async function fetchTrackPoints(sessionId: string, token: string): Promise<unknown[]> {
  const url = `https://livetrack.garmin.com/api/sessions/${sessionId}/track-points/common?token=${token}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`LiveTrack request failed (${res.status})`);
  const raw = (await res.json()) as { trackPoints?: unknown[] };
  return Array.isArray(raw.trackPoints) ? raw.trackPoints : [];
}

function extractPoint(raw: unknown): LiveTrackPoint | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const meta = (r.metaData ?? r.meta ?? {}) as Record<string, unknown>;

  const lat = toNumber(r.latitude ?? r.lat);
  const lon = toNumber(r.longitude ?? r.lon ?? r.lng);
  if (lat == null || lon == null) return null;

  const timestamp = toNumber(r.timestamp ?? r.dateTime ?? r.recordedAt ?? r.epochMs) ?? Date.now();
  const distanceRaw = toNumber(r.totalDistance ?? r.distance ?? meta.TOTAL_DISTANCE ?? meta.totalDistance);
  const elevationRaw = toNumber(r.elevation ?? meta.ELEVATION ?? meta.elevation);
  const speedRaw = toNumber(r.speed ?? meta.SPEED ?? meta.speed);

  return {
    lat,
    lon,
    timestamp,
    // Garmin's raw device telemetry is typically meters/m-per-second -
    // unconfirmed for this endpoint specifically (see note above).
    distanceKm: distanceRaw != null ? distanceRaw / 1000 : null,
    elevationM: elevationRaw,
    speedKmh: speedRaw != null ? speedRaw * 3.6 : null,
  };
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
    const raw = await fetchTrackPoints(parsed.sessionId, parsed.token);
    const points = raw.map(extractPoint).filter((p): p is LiveTrackPoint => p != null);
    res.status(200).json({ status: "ready", points } satisfies LiveTrackResult);
  } catch (error) {
    const result: LiveTrackResult = {
      status: "error",
      message: error instanceof Error ? error.message : "LiveTrack request failed",
    };
    res.status(200).json(result);
  }
}
