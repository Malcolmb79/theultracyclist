import type { VercelRequest, VercelResponse } from "@vercel/node";
import { XMLParser } from "fast-xml-parser";
import { getJSON, setJSON } from "./_lib/kvStore.js";
import { getSessionEmail } from "./_lib/session.js";

type LiveTrackerConfig = {
  // Public route URL - a Ride with GPS route's public .json endpoint
  // (preferred - see fetchRoutePoints) or a plain public GPX file. Fetched
  // both here (for the simulation below) and directly by the browser (for
  // the real /live page's own distance-covered calc) - not proxied for the
  // real path, since it's a static public resource with no auth needed.
  gpxUrl?: string;
  // Garmin inReach MapShare KML feed URL (Settings -> Social -> MapShare ->
  // Feeds on the inReach/Explore account) - official, documented, designed
  // for exactly this third-party-embedding use case, unlike LiveTrack's
  // internal API (see GarminLiveTrackCard.tsx for why that one's an iframe
  // instead of parsed data).
  positionFeedUrl?: string;
  targetSeconds?: number;
  startTime?: string; // ISO
  // Set by Settings' "Simulate a test run" - a stand-in for a real
  // positionFeedUrl when testing before the actual inReach device/feed
  // exists. Mutually exclusive with positionFeedUrl (simulation wins if
  // both are somehow set). See runSimulation below for how this turns into
  // an actually-advancing position over time.
  simulation?: { startedAtMs: number; kmh: number };
  // Owner-set widget layout for the public page itself (drag/resize while
  // signed in) - same shape/positions for every visitor, since this is
  // Malcolm arranging how the public page looks, not a per-visitor
  // preference. Public GET always returns it; only an authenticated POST
  // can change it.
  layout?: LiveTrackerLayout;
};

export type LiveTrackerRect = { x: number; y: number; width: number; height: number };
export type LiveTrackerLayout = { order: string[]; rects: Record<string, LiveTrackerRect> };

export type PositionPoint = { lat: number; lon: number; timestamp: number };
type RouteInterpPoint = { lat: number; lon: number; distanceKm: number };

export type LiveTrackerPublicResult = {
  configured: boolean;
  gpxUrl: string | null;
  targetSeconds: number | null;
  startTime: string | null;
  position: PositionPoint | null;
  history: PositionPoint[];
  layout: LiveTrackerLayout | null;
  // True when the request is authenticated - the /live page uses this to
  // decide whether to render its widgets as draggable/resizable (only the
  // owner can rearrange the public page) or as plain positioned cards.
  isOwner: boolean;
  // Only present when the request is authenticated (Settings page editing
  // the config) - the public /live page never sees this, even though
  // MapShare URLs are meant to be shareable, out of caution.
  positionFeedUrl?: string;
};

const CONFIG_KEY = "LIVE_TRACKER_CONFIG";
const HISTORY_KEY = "LIVE_TRACKER_HISTORY";
const ROUTE_CACHE_KEY = "LIVE_TRACKER_ROUTE_CACHE";
const MAX_HISTORY_POINTS = 3000;
const ROUTE_CACHE_TTL_MS = 10 * 60_000;
// How much faster than real time the simulation runs - a ~16h ride at this
// speedup finishes in a little over 8 real minutes, fast enough to
// actually watch the dot move within a short testing session.
const SIM_SPEEDUP = 120;

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

// Recursively finds a "trkpt"/"rtept" key at any depth, mirroring
// findPlacemarks' tolerance for whatever the exact GPX nesting turns out
// to be - only used for the simulation's server-side route fetch; the real
// page parses GPX client-side via DOMParser instead (see gpxRoute.ts).
function findTrackPoints(node: unknown): unknown[] {
  if (node == null || typeof node !== "object") return [];
  const obj = node as Record<string, unknown>;
  for (const key of ["trkpt", "rtept"]) {
    if (key in obj) {
      const pts = obj[key];
      return Array.isArray(pts) ? pts : [pts];
    }
  }
  for (const value of Object.values(obj)) {
    const found = findTrackPoints(value);
    if (found.length > 0) return found;
  }
  return [];
}

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

// Same dual-format support as src/utils/gpxRoute.ts's client-side fetchRoute
// (kept as a separate server-side copy per this project's api/src
// decoupling convention) - only used for the simulation below, so the real
// /live page's own client-side fetch (which the athlete's actual browser
// visitors trigger) is unaffected by whatever happens here.
async function fetchRoutePoints(url: string): Promise<RouteInterpPoint[]> {
  if (url.includes(".json")) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Route request failed (${res.status})`);
    const data = (await res.json()) as { track_points?: { x?: number; y?: number; d?: number }[] };
    return (data.track_points ?? [])
      .filter((p): p is { x: number; y: number; d?: number } => typeof p.x === "number" && typeof p.y === "number")
      .map((p) => ({ lat: p.y, lon: p.x, distanceKm: (p.d ?? 0) / 1000 }));
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Route request failed (${res.status})`);
  const xml = await res.text();
  const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" }).parse(xml) as unknown;

  const points: RouteInterpPoint[] = [];
  let cumulative = 0;
  for (const raw of findTrackPoints(parsed)) {
    const pt = raw as { "@_lat"?: string; "@_lon"?: string };
    const lat = Number(pt["@_lat"]);
    const lon = Number(pt["@_lon"]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (points.length > 0) cumulative += haversineKm(points[points.length - 1], { lat, lon });
    points.push({ lat, lon, distanceKm: cumulative });
  }
  return points;
}

async function fetchRoutePointsCached(url: string): Promise<RouteInterpPoint[]> {
  const cached = await getJSON<{ url: string; points: RouteInterpPoint[]; fetchedAtMs: number }>(ROUTE_CACHE_KEY);
  if (cached && cached.url === url && Date.now() - cached.fetchedAtMs < ROUTE_CACHE_TTL_MS) {
    return cached.points;
  }
  const points = await fetchRoutePoints(url);
  await setJSON(ROUTE_CACHE_KEY, { url, points, fetchedAtMs: Date.now() });
  return points;
}

// Nearest-vertex distance -> lat/lon interpolation between the two
// surrounding route points, close enough given a GPX/RWGPS track's points
// are normally dense (every ~10-50m).
function interpolatePosition(route: RouteInterpPoint[], targetKm: number): { lat: number; lon: number } | null {
  if (route.length === 0) return null;
  if (targetKm <= route[0].distanceKm) return { lat: route[0].lat, lon: route[0].lon };
  const last = route[route.length - 1];
  if (targetKm >= last.distanceKm) return { lat: last.lat, lon: last.lon };
  for (let i = 1; i < route.length; i++) {
    if (route[i].distanceKm >= targetKm) {
      const a = route[i - 1];
      const b = route[i];
      const span = b.distanceKm - a.distanceKm || 1;
      const t = (targetKm - a.distanceKm) / span;
      return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
    }
  }
  return { lat: last.lat, lon: last.lon };
}

// Turns a stored simulation config into a live-advancing position, exactly
// as if it were coming from a real feed - called fresh on every GET poll
// rather than pre-generating a fixed set of points, so the dot actually
// keeps moving for as long as anyone has the /live page open.
async function runSimulation(
  config: LiveTrackerConfig,
  history: PositionPoint[],
): Promise<{ position: PositionPoint | null; history: PositionPoint[]; startTime: string | null }> {
  if (!config.simulation || !config.gpxUrl) return { position: null, history, startTime: config.startTime ?? null };

  const route = await fetchRoutePointsCached(config.gpxUrl);
  const totalKm = route.length > 0 ? route[route.length - 1].distanceKm : 0;
  if (totalKm === 0) return { position: null, history, startTime: config.startTime ?? null };

  const nowMs = Date.now();
  const realElapsedMs = nowMs - config.simulation.startedAtMs;
  const virtualElapsedHours = (realElapsedMs / 3_600_000) * SIM_SPEEDUP;
  const distanceKm = Math.min(totalKm, Math.max(0, virtualElapsedHours * config.simulation.kmh));
  const latLon = interpolatePosition(route, distanceKm);
  if (!latLon) return { position: null, history, startTime: config.startTime ?? null };

  const point: PositionPoint = { ...latLon, timestamp: nowMs };
  const nextHistory = mergeHistory(history, [point]);
  await setJSON(HISTORY_KEY, nextHistory);

  // Reported startTime is back-dated by the same virtual-elapsed amount, so
  // the client's plain (now - startTime) elapsed-time math lines up with
  // the sped-up simulation instead of showing real (much shorter) elapsed
  // time against a full-distance position.
  const reportedStartTime = new Date(nowMs - virtualElapsedHours * 3_600_000).toISOString();
  return { position: point, history: nextHistory, startTime: reportedStartTime };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "POST") {
    if (!getSessionEmail(req)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const body = (req.body ?? {}) as LiveTrackerConfig & { resetHistory?: boolean };
    // Merge onto the existing stored config rather than replacing it
    // wholesale - the /live page now POSTs layout-only updates on every
    // drag/resize, and a full replace would silently wipe gpxUrl/
    // positionFeedUrl/targetSeconds/startTime/simulation on every one of
    // those. "field" in body distinguishes "not sent" from "explicitly
    // cleared to undefined", same pattern as PATCH /api/transactions/:id.
    const existing = (await getJSON<LiveTrackerConfig>(CONFIG_KEY)) ?? {};
    const config: LiveTrackerConfig = { ...existing };
    if ("gpxUrl" in body) config.gpxUrl = body.gpxUrl;
    if ("positionFeedUrl" in body) config.positionFeedUrl = body.positionFeedUrl;
    if ("targetSeconds" in body) config.targetSeconds = body.targetSeconds;
    if ("startTime" in body) config.startTime = body.startTime;
    if ("simulation" in body) config.simulation = body.simulation;
    if ("layout" in body) config.layout = body.layout;
    await setJSON(CONFIG_KEY, config);
    if (body.resetHistory) {
      await setJSON(HISTORY_KEY, []);
      // A reset should stop any simulation too, not just clear the map -
      // otherwise the very next poll immediately regenerates a position
      // from the simulation that's still running.
      await setJSON(CONFIG_KEY, { ...config, simulation: undefined });
    }
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
  let effectiveStartTime = config.startTime ?? null;

  if (config.simulation) {
    try {
      const sim = await runSimulation(config, history);
      history = sim.history;
      effectiveStartTime = sim.startTime;
    } catch {
      // Route temporarily unreachable - fall through and serve whatever
      // history is already stored.
    }
  } else if (config.positionFeedUrl) {
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
    // position…"), and this also lets a simulation run before a real
    // position feed exists.
    configured: Boolean(config.gpxUrl && config.targetSeconds),
    gpxUrl: config.gpxUrl ?? null,
    targetSeconds: config.targetSeconds ?? null,
    startTime: effectiveStartTime,
    position: history.length > 0 ? history[history.length - 1] : null,
    history,
    layout: config.layout ?? null,
    isOwner,
    ...(isOwner ? { positionFeedUrl: config.positionFeedUrl } : {}),
  };
  res.setHeader("Cache-Control", isOwner || config.simulation ? "private, no-store" : "public, s-maxage=15, stale-while-revalidate=30");
  res.status(200).json(result);
}
