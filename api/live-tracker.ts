import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getJSON, setJSON } from "./_lib/kvStore.js";
import { getSessionEmail } from "./_lib/session.js";
import { latestPerDevice, mergePosition, trackPoints } from "./_lib/trackerDb.js";

/**
 * Position now comes from the real Edge 1040 / Traccar pipeline
 * (api/ingest.ts, api/traccar-osmand.ts, api/_lib/trackerDb.ts) rather than
 * a Redis-stored simulation or a Garmin inReach MapShare feed - both of
 * those were stand-ins for a real position source that now exists, and kept
 * around would just be a second, disconnected way to answer "where is the
 * rider" that could quietly disagree with the one everything else uses.
 *
 * What stays here: the config the public /live page needs that has nothing
 * to do with *where* the position comes from - the route line, the target
 * time, the owner-editable widget layout, and the visibility toggle. Those
 * are still simple Redis-backed settings, unrelated to the tracker pipeline.
 */
type LiveTrackerConfig = {
  // Public route URL - a Ride with GPS route's public .json endpoint
  // (preferred - see fetchRoute) or a plain public GPX file. Fetched
  // client-side by the /live page itself for the route line.
  gpxUrl?: string;
  targetSeconds?: number;
  startTime?: string; // ISO
  // Owner-set widget layout for the public page itself (drag/resize while
  // signed in) - same shape/positions for every visitor, since this is
  // Malcolm arranging how the public page looks, not a per-visitor
  // preference. Public GET always returns it; only an authenticated POST
  // can change it.
  layout?: LiveTrackerLayout;
  // Settings' "Show live page to visitors" toggle - lets the owner hide
  // the public page (e.g. before the attempt starts, or once it's over)
  // without losing gpxUrl/targetSeconds/etc, unlike clearing those fields
  // outright. undefined behaves as true (visible), so configs saved before
  // this field existed keep working unchanged. Only affects non-owner
  // requests - the owner can still see/preview the real page while it's
  // hidden from everyone else.
  visible?: boolean;
};

export type LiveTrackerRect = { x: number; y: number; width: number; height: number };
export type LiveTrackerLayout = { order: string[]; rects: Record<string, LiveTrackerRect> };

export type PositionPoint = { lat: number; lon: number; timestamp: number };

// Matches the map-track density the page was already tuned for.
const HISTORY_POINTS = 3000;

export type LiveTrackerPublicResult = {
  configured: boolean;
  gpxUrl: string | null;
  targetSeconds: number | null;
  startTime: string | null;
  position: PositionPoint | null;
  history: PositionPoint[];
  // Always null now that there's no simulation to report a sped-up rate
  // for - kept in the response shape so the client's
  // `data.simulatedKmh ?? currentPaceKmh(data.history)` fallback (now
  // always the real-history branch) needs no change.
  simulatedKmh: null;
  // Resolved (undefined -> true) - lets Settings show the current toggle
  // state without needing to special-case "never set" vs "explicitly on".
  visible: boolean;
  layout: LiveTrackerLayout | null;
  // True when the request is authenticated - the /live page uses this to
  // decide whether to render its widgets as draggable/resizable (only the
  // owner can rearrange the public page) or as plain positioned cards.
  isOwner: boolean;
};

const CONFIG_KEY = "LIVE_TRACKER_CONFIG";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "POST") {
    if (!getSessionEmail(req)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const body = (req.body ?? {}) as LiveTrackerConfig;
    // Merge onto the existing stored config rather than replacing it
    // wholesale - the /live page now POSTs layout-only updates on every
    // drag/resize, and a full replace would silently wipe gpxUrl/
    // targetSeconds/startTime on every one of those. "field" in body
    // distinguishes "not sent" from "explicitly cleared to undefined",
    // same pattern as PATCH /api/transactions/:id.
    const existing = (await getJSON<LiveTrackerConfig>(CONFIG_KEY)) ?? {};
    const config: LiveTrackerConfig = { ...existing };
    if ("gpxUrl" in body) config.gpxUrl = body.gpxUrl;
    if ("targetSeconds" in body) config.targetSeconds = body.targetSeconds;
    if ("startTime" in body) config.startTime = body.startTime;
    if ("layout" in body) config.layout = body.layout;
    if ("visible" in body) config.visible = body.visible;
    await setJSON(CONFIG_KEY, config);
    res.status(200).json({ ok: true });
    return;
  }

  // GET is intentionally public (no auth check) - this is the data source
  // for the public /live page, which followers view without signing in.
  const isOwner = Boolean(getSessionEmail(req));
  const config = (await getJSON<LiveTrackerConfig>(CONFIG_KEY)) ?? {};
  const nowTs = Math.floor(Date.now() / 1000);

  const devices = await latestPerDevice();
  const merged = mergePosition(devices.edge1040 ?? null, devices.traccar ?? null, nowTs);
  const position: PositionPoint | null = merged != null ? { lat: merged.lat, lon: merged.lon, timestamp: merged.ts * 1000 } : null;

  const rawHistory = await trackPoints(HISTORY_POINTS);
  const history: PositionPoint[] = rawHistory.map((p) => ({ lat: p.lat, lon: p.lon, timestamp: p.ts * 1000 }));

  // undefined -> true (visible), so configs saved before this toggle
  // existed are unaffected. Only gates the public view - the owner sees
  // the real page regardless, so they can preview/test it while hidden.
  const isVisible = config.visible !== false;

  const result: LiveTrackerPublicResult = {
    // A position isn't required for the page to be worth showing - it
    // already handles position: null gracefully ("Waiting for position…").
    configured: Boolean(config.gpxUrl && config.targetSeconds && (isOwner || isVisible)),
    gpxUrl: config.gpxUrl ?? null,
    targetSeconds: config.targetSeconds ?? null,
    startTime: config.startTime ?? null,
    position,
    history,
    simulatedKmh: null,
    visible: isVisible,
    layout: config.layout ?? null,
    isOwner,
  };
  res.setHeader("Cache-Control", isOwner ? "private, no-store" : "public, s-maxage=15, stale-while-revalidate=30");
  res.status(200).json(result);
}
