import type { VercelRequest, VercelResponse } from "@vercel/node";
import { XMLParser } from "fast-xml-parser";
import { getJSON, setJSON } from "./_lib/kvStore.js";
import { getSessionEmail } from "./_lib/session.js";

type LiveTrackerConfig = {
  // Public GPX export of the planned route (e.g. a Ride with GPS route's
  // public .gpx URL) - fetched directly by the browser, not proxied here,
  // since it's a static public file with no auth needed.
  gpxUrl?: string;
  // Garmin inReach MapShare KML feed URL (Settings -> Social -> MapShare ->
  // Feeds on the inReach/Explore account) - official, documented, designed
  // for exactly this third-party-embedding use case, unlike LiveTrack's
  // internal API (see GarminLiveTrackCard.tsx for why that one's an iframe
  // instead of parsed data).
  positionFeedUrl?: string;
  targetSeconds?: number;
  startTime?: string; // ISO
};

export type PositionPoint = { lat: number; lon: number; timestamp: number };

export type LiveTrackerPublicResult = {
  configured: boolean;
  gpxUrl: string | null;
  targetSeconds: number | null;
  startTime: string | null;
  position: PositionPoint | null;
  history: PositionPoint[];
  // Only present when the request is authenticated (Settings page editing
  // the config) - the public /live page never sees this, even though
  // MapShare URLs are meant to be shareable, out of caution.
  positionFeedUrl?: string;
};

const CONFIG_KEY = "LIVE_TRACKER_CONFIG";
const HISTORY_KEY = "LIVE_TRACKER_HISTORY";
const MAX_HISTORY_POINTS = 3000;

// Recursively finds a "Placemark" key at any depth in the parsed KML tree,
// rather than assuming one exact Document/Folder nesting - the feed hasn't
// been tested against a real inReach account yet (see Settings' hint text),
// so this is deliberately tolerant of whatever the real structure turns
// out to be, only relying on the KML spec's own Point/coordinates and
// TimeStamp/when shape (those are standard KML, not Garmin-specific).
function findPlacemarks(node: unknown): unknown[] {
  if (node == null || typeof node !== "object") return [];
  const obj = node as Record<string, unknown>;
  if ("Placemark" in obj) {
    const pm = obj.Placemark;
    return Array.isArray(pm) ? pm : [pm];
  }
  for (const value of Object.values(obj)) {
    const found = findPlacemarks(value);
    if (found.length > 0) return found;
  }
  return [];
}

async function fetchLatestPositions(feedUrl: string): Promise<PositionPoint[]> {
  const res = await fetch(feedUrl);
  if (!res.ok) throw new Error(`MapShare feed request failed (${res.status})`);
  const xml = await res.text();
  const parsed = new XMLParser({ ignoreAttributes: false }).parse(xml) as unknown;

  const points: PositionPoint[] = [];
  for (const raw of findPlacemarks(parsed)) {
    const pm = raw as { Point?: { coordinates?: string }; TimeStamp?: { when?: string } };
    const coordStr = pm.Point?.coordinates;
    const when = pm.TimeStamp?.when;
    if (!coordStr || !when) continue;
    const [lonStr, latStr] = coordStr.trim().split(",");
    const lat = Number(latStr);
    const lon = Number(lonStr);
    const timestamp = Date.parse(when);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(timestamp)) {
      points.push({ lat, lon, timestamp });
    }
  }
  points.sort((a, b) => a.timestamp - b.timestamp);
  return points;
}

function mergeHistory(existing: PositionPoint[], fresh: PositionPoint[]): PositionPoint[] {
  const byTimestamp = new Map(existing.map((p) => [p.timestamp, p]));
  for (const p of fresh) byTimestamp.set(p.timestamp, p);
  const merged = Array.from(byTimestamp.values()).sort((a, b) => a.timestamp - b.timestamp);
  return merged.slice(-MAX_HISTORY_POINTS);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "POST") {
    if (!getSessionEmail(req)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const body = (req.body ?? {}) as LiveTrackerConfig & { resetHistory?: boolean; seedHistory?: PositionPoint[] };
    const config: LiveTrackerConfig = {
      gpxUrl: body.gpxUrl,
      positionFeedUrl: body.positionFeedUrl,
      targetSeconds: body.targetSeconds,
      startTime: body.startTime,
    };
    await setJSON(CONFIG_KEY, config);
    if (body.resetHistory) await setJSON(HISTORY_KEY, []);
    // Test/demo data (Settings' "Simulate a test run") - overwrites rather
    // than merges, since it's meant to replace whatever's there with a
    // fresh synthetic run, not blend with real device data.
    if (body.seedHistory) await setJSON(HISTORY_KEY, body.seedHistory);
    res.status(200).json({ ok: true });
    return;
  }

  // GET is intentionally public (no auth check) - this is the data source
  // for the public /live page, which followers view without signing in.
  // Authenticated requests (the Settings page editing the config) also get
  // positionFeedUrl back so the form can show/edit the current value.
  const isOwner = Boolean(getSessionEmail(req));
  const config = (await getJSON<LiveTrackerConfig>(CONFIG_KEY)) ?? {};
  let history = (await getJSON<PositionPoint[]>(HISTORY_KEY)) ?? [];

  if (config.positionFeedUrl) {
    try {
      const fresh = await fetchLatestPositions(config.positionFeedUrl);
      if (fresh.length > 0) {
        history = mergeHistory(history, fresh);
        await setJSON(HISTORY_KEY, history);
      }
    } catch {
      // Feed temporarily unreachable - fall through and serve whatever
      // history is already stored rather than failing the whole request.
    }
  }

  const result: LiveTrackerPublicResult = {
    // positionFeedUrl isn't required for the page to be worth showing - the
    // page already handles position: null gracefully ("Waiting for
    // position…"), and this also lets Settings' seeded test data render
    // the full page before a real position feed exists.
    configured: Boolean(config.gpxUrl && config.targetSeconds),
    gpxUrl: config.gpxUrl ?? null,
    targetSeconds: config.targetSeconds ?? null,
    startTime: config.startTime ?? null,
    position: history.length > 0 ? history[history.length - 1] : null,
    history,
    ...(isOwner ? { positionFeedUrl: config.positionFeedUrl } : {}),
  };
  res.setHeader("Cache-Control", isOwner ? "private, no-store" : "public, s-maxage=15, stale-while-revalidate=30");
  res.status(200).json(result);
}
