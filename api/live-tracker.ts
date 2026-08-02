import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getJSON, readJSON, setJSON } from "./_lib/kvStore.js";
import { getSessionEmail } from "./_lib/session.js";
import {
  SESSION_ENDED_S,
  TRACKING_IDLE_S,
  latestPerDevice,
  latestSessionEvent,
  mergePosition,
  trackPoints,
} from "./_lib/trackerDb.js";
import { isDeviceCategory, mergeDeviceValue, resolveDeviceValue, type DeviceCategory } from "./_lib/deviceLayout.js";

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
  // signed in) - same positions for every visitor on a given device class,
  // since this is Malcolm arranging how the public page looks, not a
  // per-visitor preference. Public GET always returns it; only an
  // authenticated POST can change it.
  //
  // Stored per device category, like dashboard/trends/coaching. It was a
  // single layout for every screen, which meant the phone rendered the
  // desktop rects verbatim: the map, sized 1160x1360 on a monitor, came
  // out 1360px tall on an ~870px-tall phone with its zoom slider scrolled
  // off the top and the elevation profile off the bottom. Worse, any
  // drag/resize done on the phone to fix that overwrote the desktop
  // arrangement. The bare LiveTrackerLayout is the pre-split shape and is
  // still read (and promoted to the desktop entry on the next save).
  layout?: LiveTrackerLayout | Partial<Record<DeviceCategory, LiveTrackerLayout>>;
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
  /**
   * Whether samples are arriving right now, derived from the ingest feed
   * itself rather than from the configured start time. Starting the Edge is
   * what actually begins the attempt, and stopping it is what ends it, so the
   * page follows that instead of a time typed in beforehand - which is only
   * ever a prediction, and one nobody wants to be editing from the roadside
   * when the start slips by an hour.
   */
  tracking: {
    active: boolean;
    lastSampleTs: number | null;
    ageS: number | null;
    /**
     * The session's lifecycle, which the page renders rather than deciding
     * for itself:
     *
     *   pending - the tracker has never sent anything
     *   live    - samples arriving now
     *   stalled - quiet, but not long enough to call it over. Probably a
     *             dropout; the numbers stand as the last known ones
     *   ended   - quiet long enough that the ride is finished, and the
     *             numbers are the final result rather than stale live data
     */
    state: "pending" | "live" | "stalled" | "ended";
    /**
     * When the athlete last pressed start, from the device's own timer
     * event. The page uses it as a session identity: a value it hasn't seen
     * before means a new ride, and the map resets rather than drawing the
     * new one on top of the old one's track.
     */
    sessionStartTs: number | null;
    /** When stop was pressed, if it has been. */
    sessionEndTs: number | null;
  };
  // True when the request is authenticated - the /live page uses this to
  // decide whether to render its widgets as draggable/resizable (only the
  // owner can rearrange the public page) or as plain positioned cards.
  isOwner: boolean;
};

const CONFIG_KEY = "LIVE_TRACKER_CONFIG";

// Both the pre-split single layout and the per-device record are plain
// objects, so they're told apart by shape rather than by Array.isArray -
// only the single layout has `order`/`rects`.
function isSingleLayout(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && "rects" in (value as Record<string, unknown>));
}

function deviceFrom(req: VercelRequest): DeviceCategory {
  const value = (req.query.device as string | undefined) ?? (req.body as { device?: string } | undefined)?.device;
  return isDeviceCategory(value) ? value : "desktop";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "POST") {
    if (!getSessionEmail(req)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    // A POST carries the layout for one device only - the sender's - which
    // gets merged into the stored per-device record below.
    const body = (req.body ?? {}) as Omit<LiveTrackerConfig, "layout"> & { layout?: LiveTrackerLayout };
    // Merge onto the existing stored config rather than replacing it
    // wholesale - the /live page now POSTs layout-only updates on every
    // drag/resize, and a full replace would silently wipe gpxUrl/
    // targetSeconds/startTime on every one of those. "field" in body
    // distinguishes "not sent" from "explicitly cleared to undefined",
    // same pattern as PATCH /api/transactions/:id.
    //
    // readJSON (not getJSON) so an unreachable Redis surfaces instead of
    // reading as an empty config: this is a read-modify-write, and treating
    // a transient blip as "nothing stored" would write a record holding
    // only whatever this one request sent - wiping the route URL, the
    // target time, and every other device's layout. Same guard as
    // dashboard-layout.ts.
    let existing: LiveTrackerConfig;
    try {
      existing = (await readJSON<LiveTrackerConfig>(CONFIG_KEY)) ?? {};
    } catch (error) {
      console.error("Refusing to save live tracker config - could not read current state", error);
      res.status(503).json({ error: "Storage is unavailable right now - nothing was saved." });
      return;
    }
    const config: LiveTrackerConfig = { ...existing };
    if ("gpxUrl" in body) config.gpxUrl = body.gpxUrl;
    if ("targetSeconds" in body) config.targetSeconds = body.targetSeconds;
    if ("startTime" in body) config.startTime = body.startTime;
    if ("layout" in body && body.layout) {
      config.layout = mergeDeviceValue<LiveTrackerLayout>(existing.layout, deviceFrom(req), body.layout, isSingleLayout);
    }
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

  // Newest sample from either device, not just whichever one won the position
  // merge: Traccar alone still means the tracker is running, and so does the
  // Edge alone. Only silence from both is a stopped tracker.
  const newestSampleTs = Math.max(devices.edge1040?.ts ?? 0, devices.traccar?.ts ?? 0);
  const trackingAgeS = newestSampleTs > 0 ? nowTs - newestSampleTs : null;

  // The device's own start/stop beats anything inferred from silence. Only
  // when it has told us nothing do the timeouts decide, which is still the
  // case for a phone-only feed and for any ride recorded before the Edge
  // learned to send markers.
  const sessionEvent = await latestSessionEvent();
  const sessionStopped = sessionEvent?.event === 2;
  const sessionStartTs = sessionEvent?.event === 1 ? sessionEvent.ts : null;
  const sessionEndTs = sessionStopped ? sessionEvent.ts : null;

  const trackingState: LiveTrackerPublicResult["tracking"]["state"] = sessionStopped
    ? "ended"
    : trackingAgeS == null
      ? "pending"
      : trackingAgeS <= TRACKING_IDLE_S
        ? "live"
        : trackingAgeS <= SESSION_ENDED_S
          ? "stalled"
          : "ended";

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
    layout: resolveDeviceValue<LiveTrackerLayout>(config.layout, deviceFrom(req), isSingleLayout),
    tracking: {
      active: trackingAgeS != null && trackingAgeS <= TRACKING_IDLE_S,
      lastSampleTs: newestSampleTs > 0 ? newestSampleTs : null,
      ageS: trackingAgeS,
      state: trackingState,
      sessionStartTs,
      sessionEndTs,
    },
    isOwner,
  };
  // The response now varies by ?device=, so the shared cache keys on the
  // full URL rather than the path - a phone's layout can't be served to a
  // desktop visitor from an edge cache entry.
  res.setHeader("Cache-Control", isOwner ? "private, no-store" : "public, s-maxage=15, stale-while-revalidate=30");
  res.status(200).json(result);
}
