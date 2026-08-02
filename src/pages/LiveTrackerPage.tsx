import { useEffect, useRef, useState } from "react";
import LiveTrackerMap, { type LiveTelemetry } from "../components/liveTracker/LiveTrackerMap";
import LiveTrackerWidget from "../components/liveTracker/LiveTrackerWidget";
import FundraiserProgress from "../components/fundraiser/FundraiserProgress";
import { fetchRoute, distanceCoveredKm, totalDistanceKm, haversineKm, type RoutePoint } from "../utils/gpxRoute";
import { useDeviceCategory } from "../utils/useDeviceCategory";
import { computeCanvasHeight } from "../utils/useCanvasItem";
import { useMeasuredWidth } from "../utils/useMeasuredWidth";
import { useDashboardTheme } from "../utils/useDashboardTheme";
import { useTheme, type ThemeMode } from "../context/ThemeContext";
import styles from "./LiveTrackerPage.module.css";

const POLL_INTERVAL_MS = 20_000;
// Open-Meteo's current-conditions numbers don't change meaningfully more
// often than their own hourly model update cadence, so polling every 10
// minutes was mostly wasted requests - refreshed hourly instead.
const WEATHER_INTERVAL_MS = 60 * 60_000;

type PositionPoint = { lat: number; lon: number; timestamp: number };
type LiveTrackerRect = { x: number; y: number; width: number; height: number };
// "weather" isn't a widget of its own - it's overlaid directly on the map
// (see LiveTrackerMap), which is also where the headwind/tailwind
// computation now lives since that needs the route + covered distance the
// map already has.
type LiveWidgetId = "pace" | "progress" | "map" | "eta" | "donate";
type LiveTrackerLayout = { order: LiveWidgetId[]; rects: Record<LiveWidgetId, LiveTrackerRect> };

// Mirrors api/live-tracker.ts's public response shape - duplicated per this
// project's api/src decoupling convention (see other widgets for the same
// pattern).
type ApiResult = {
  configured: boolean;
  gpxUrl: string | null;
  targetSeconds: number | null;
  startTime: string | null;
  position: PositionPoint | null;
  history: PositionPoint[];
  simulatedKmh: number | null;
  visible: boolean;
  layout: LiveTrackerLayout | null;
  // Whether samples are arriving right now, from the ingest feed itself
  // rather than the configured start time - starting the tracker is what
  // actually begins the attempt. See api/live-tracker.ts.
  //
  // Optional because the GET is edge-cached for 15 seconds for anonymous
  // visitors, so for a few seconds after a deploy a new bundle can be handed
  // a response body from before this field existed. Reading `.active` off an
  // absent object there would blank the whole page over a cosmetic badge.
  tracking?: {
    active: boolean;
    lastSampleTs: number | null;
    ageS: number | null;
    state: "pending" | "live" | "stalled" | "ended";
    sessionStartTs: number | null;
    sessionEndTs: number | null;
  };
  isOwner: boolean;
};

type WeatherState = { temp: number; windSpeed: number; windDirection: number; code: number } | null;

const MIN_SIZE: Record<LiveWidgetId, { minWidth: number; minHeight: number }> = {
  pace: { minWidth: 280, minHeight: 130 },
  progress: { minWidth: 280, minHeight: 150 },
  // Taller minimum than before - the map now also carries the weather
  // overlay and the optional elevation-profile panel, both of which need
  // room without swallowing the whole map view.
  map: { minWidth: 320, minHeight: 380 },
  eta: { minWidth: 200, minHeight: 130 },
  // Reuses FundraiserProgress (the same donation view from /the-cause) -
  // needs more room than the other side-panel cards for its stats grid and
  // donor list, though .content's overflow-y:auto (see
  // LiveTrackerWidget.module.css) covers whatever doesn't fit at the
  // default size.
  donate: { minWidth: 240, minHeight: 300 },
};

const WIDGET_IDS: LiveWidgetId[] = ["pace", "progress", "map", "eta", "donate"];

const DEFAULT_LAYOUT: LiveTrackerLayout = {
  order: WIDGET_IDS,
  rects: {
    pace: { x: 0, y: 0, width: 900, height: 140 },
    progress: { x: 0, y: 160, width: 900, height: 160 },
    map: { x: 0, y: 340, width: 900, height: 500 },
    eta: { x: 920, y: 340, width: 260, height: 150 },
    donate: { x: 920, y: 510, width: 260, height: 330 },
  },
};

// Fills in defaults for any widget id missing from a saved layout (e.g. one
// saved before a widget existed, or - going the other way - drops an id
// that no longer exists, like "weather" after it moved onto the map) rather
// than assuming the saved shape is always complete or still current.
function mergeLayout(saved: LiveTrackerLayout | null): LiveTrackerLayout {
  if (!saved) return DEFAULT_LAYOUT;
  const validOrder = saved.order.filter((id) => (WIDGET_IDS as string[]).includes(id));
  const missing = WIDGET_IDS.filter((id) => !validOrder.includes(id));
  const rects = Object.fromEntries(WIDGET_IDS.map((id) => [id, saved.rects[id] ?? DEFAULT_LAYOUT.rects[id]])) as Record<
    LiveWidgetId,
    LiveTrackerRect
  >;
  return { order: [...validOrder, ...missing], rects };
}

function formatDuration(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? "-" : "";
  const abs = Math.abs(Math.round(totalSeconds));
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  return `${sign}${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

function relativeSeconds(timestampMs: number): string {
  const diffSec = Math.max(0, Math.round((Date.now() - timestampMs) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  return `${Math.round(diffSec / 3600)}h ago`;
}

// Current pace from the last two distinct position readings, rather than a
// device-reported speed field (we don't have one - see the "no live
// telemetry" note below) - a simple distance/time delta between the two
// most recent points. data.simulatedKmh is always null now that position
// comes from the real Edge 1040/Traccar pipeline rather than a simulation,
// so the `data.simulatedKmh ?? currentPaceKmh(...)` fallback below always
// takes this branch - kept as a fallback rather than removed outright in
// case a simulation mode returns for testing before a future attempt.
function currentPaceKmh(history: PositionPoint[]): number | null {
  if (history.length < 2) return null;
  const a = history[history.length - 2];
  const b = history[history.length - 1];
  const hours = (b.timestamp - a.timestamp) / 3_600_000;
  if (hours <= 0) return null;
  return haversineKm(a, b) / hours;
}

// Public "dot-watching" page for the actual attempt, separate from the
// Microsoft-gated /dashboard app - no sign-in required to view, meant to be
// shared with followers. Position comes from the athlete's Garmin inReach
// MapShare feed (api/live-tracker.ts), the route from a public GPX/RWGPS
// export, and weather from Open-Meteo at the athlete's current position
// (not the visitor's own location, unlike the dashboard's Weather widget).
//
// Live power/HR/cadence used to be left out entirely: Garmin's Connect API
// is suspended for new signups and isn't real-time even when open, and
// LiveTrack's own page doesn't surface performance data - so rather than
// fake numbers at real followers watching a real attempt, there were no
// tiles at all. The Edge 1040 Connect IQ app in connectiq/edge-tracker
// closed that gap by sending the sensor data itself, so those readings are
// now real and available as per-field toggles on the map (see
// TELEMETRY_FIELDS in LiveTrackerMap). The original principle still holds:
// every field offered there is one the device actually measures, and a
// missing reading shows "—" rather than a plausible-looking substitute.
//
// Widgets are drag/resize-able exactly like Dashboard/Trends/Coaching, but
// only for the signed-in owner (api/live-tracker.ts's isOwner, from the
// same session cookie the Microsoft-gated dashboard uses) - public
// visitors get the same saved layout rendered read-only, since there's no
// per-visitor preference to speak of here.
//
// Visually themed the same as Dashboard/Trends/Coaching (shared CSS
// variables, same light/dark logic via useDashboardTheme) rather than its
// original bespoke "mission control" palette - this is still a standalone
// public page with none of the private dashboard's nav/auth chrome, just
// matching look and feel.
// Cycles in the order a visitor would expect to find them, with auto last
// as the "stop choosing for me" option rather than the first thing you hit.
const THEME_CYCLE: ThemeMode[] = ["light", "dark", "auto"];
const THEME_ICON: Record<ThemeMode, string> = { light: "☀", dark: "☾", auto: "◐" };
const THEME_LABEL: Record<ThemeMode, string> = { light: "Light", dark: "Dark", auto: "Auto" };

export default function LiveTrackerPage() {
  useDashboardTheme();
  // Same context, same localStorage key as the rest of the site, so a
  // visitor who set a preference on /the-cause finds it honoured here and
  // vice versa. This page had no control of its own only because it's a
  // standalone route with none of the site's usual chrome.
  const { mode, setMode } = useTheme();
  const [data, setData] = useState<ApiResult | null>(null);
  const [route, setRoute] = useState<RoutePoint[]>([]);
  const [routeName, setRouteName] = useState<string | null>(null);
  const [routeDescription, setRouteDescription] = useState<string | null>(null);
  const [routeError, setRouteError] = useState(false);
  const [weather, setWeather] = useState<WeatherState>(null);
  const [telemetry, setTelemetry] = useState<LiveTelemetry>(null);
  // When that telemetry landed, so the elapsed clock can be advanced from it
  // between polls rather than stepping 20 seconds at a time.
  const [telemetryAt, setTelemetryAt] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [layout, setLayout] = useState<LiveTrackerLayout | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const layoutSeeded = useRef(false);
  const device = useDeviceCategory();
  const stacked = device !== "desktop";
  // Real rendered width of the canvas, so the fit factor below is computed
  // against what's actually available rather than assumed page padding.
  const [canvasRef, canvasWidth] = useMeasuredWidth<HTMLElement>(1400);

  // ?device= picks which of the saved per-device layouts to render (see
  // api/_lib/deviceLayout.ts) - phone, tablet and PC each keep their own
  // widget sizes, so the desktop map's rect isn't what a phone visitor
  // gets. Re-seeds when the category changes (rotating a tablet, dragging
  // a desktop window narrow) rather than keeping the first one loaded.
  useEffect(() => {
    let cancelled = false;
    layoutSeeded.current = false;
    const load = () => {
      fetch(`/api/live-tracker?device=${device}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Request failed"))))
        .then((body: ApiResult) => {
          if (cancelled) return;
          setData(body);
          // Seed local layout state once from whatever the server has -
          // afterwards this page is the source of truth for its own layout
          // (updated optimistically on every drag/resize/reorder), so a
          // later poll picking up a slightly stale server value doesn't
          // fight with an in-progress edit.
          if (!layoutSeeded.current) {
            layoutSeeded.current = true;
            setLayout(mergeLayout(body.layout));
          }
        })
        .catch(() => {});
    };
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [device]);

  // Ride telemetry comes from /api/live.json rather than /api/live-tracker:
  // that endpoint already computes every reading the Edge 1040 Connect IQ
  // app sends, plus the rolling averages (30s power, normalised power,
  // 5-minute heart rate) which are deliberately server-side - "a thousand
  // phones each deriving a projection from a raw sample list is a thousand
  // chances to disagree". Polled on the same cadence as the position feed;
  // it's edge-cached for 10s, so a crowd of dot-watchers still costs one
  // database read per ten seconds.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/live.json")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Request failed"))))
        .then((body: NonNullable<LiveTelemetry>) => {
          if (cancelled) return;
          setTelemetry(body);
          setTelemetryAt(Date.now());
        })
        .catch(() => {});
    };
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!data?.gpxUrl) return;
    let cancelled = false;
    setRouteError(false);
    fetchRoute(data.gpxUrl)
      .then((r) => {
        if (cancelled) return;
        setRoute(r.points);
        setRouteName(r.name);
        setRouteDescription(r.description);
      })
      .catch(() => {
        if (!cancelled) setRouteError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [data?.gpxUrl]);

  useEffect(() => {
    if (!data?.position) return;
    let cancelled = false;
    const load = () => {
      const { lat, lon } = data.position!;
      fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m`,
      )
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Weather request failed"))))
        .then((body) => {
          if (cancelled) return;
          const c = body.current;
          setWeather({
            temp: Math.round(c.temperature_2m),
            windSpeed: Math.round(c.wind_speed_10m),
            windDirection: c.wind_direction_10m,
            code: c.weather_code,
          });
        })
        .catch(() => {});
    };
    load();
    const interval = setInterval(load, WEATHER_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.position?.lat, data?.position?.lon]);

  // Saves against this device category only - the server merges it into the
  // stored per-device record and leaves the others alone, so rearranging
  // the page on a phone during the attempt can't flatten the desktop view
  // that everyone on a laptop is watching.
  // The browser tab and any shared link carry the route's name too - a tab
  // reading "The Ultra Cyclist" among twenty others says less than one
  // naming the ride being watched.
  useEffect(() => {
    const base = document.title;
    if (routeName) document.title = `${routeName} — Live`;
    return () => {
      document.title = base;
    };
  }, [routeName]);

  // Drives the elapsed clock while a session is running. Only while running:
  // once the tracker stops there is nothing to count, and a page left open
  // overnight shouldn't re-render every second forever.
  const sessionIsLive = data?.tracking?.state === "live";
  useEffect(() => {
    if (!sessionIsLive) return;
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [sessionIsLive]);

  const persistLayout = (next: LiveTrackerLayout) => {
    setLayout(next);
    fetch("/api/live-tracker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layout: next, device }),
    }).catch(() => {});
  };

  const handleMove = (id: LiveWidgetId, x: number, y: number) => {
    if (!layout) return;
    persistLayout({ ...layout, rects: { ...layout.rects, [id]: { ...layout.rects[id], x, y } } });
  };

  const handleResize = (id: LiveWidgetId, width: number, height: number) => {
    if (!layout) return;
    persistLayout({ ...layout, rects: { ...layout.rects, [id]: { ...layout.rects[id], width, height } } });
  };

  const handleReorder = (id: LiveWidgetId, direction: "up" | "down") => {
    if (!layout) return;
    const index = layout.order.indexOf(id);
    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (index === -1 || swapWith < 0 || swapWith >= layout.order.length) return;
    const nextOrder = layout.order.slice();
    [nextOrder[index], nextOrder[swapWith]] = [nextOrder[swapWith], nextOrder[index]];
    persistLayout({ ...layout, order: nextOrder });
  };

  if (!data) {
    return (
      <div className={styles.page}>
        <p className={styles.loading}>Loading…</p>
      </div>
    );
  }

  if (!data.configured) {
    return (
      <div className={styles.page}>
        <div className={styles.notConfigured}>
          <h1>Live Tracker</h1>
          <p>Not set up yet - check back once the attempt is underway.</p>
        </div>
      </div>
    );
  }

  const totalKm = totalDistanceKm(route);
  const coveredKm = data.position && route.length > 0 ? distanceCoveredKm(route, data.position) : 0;
  const remainingKm = Math.max(0, totalKm - coveredKm);
  const progressPct = totalKm > 0 ? Math.min(100, (coveredKm / totalKm) * 100) : 0;
  // The Edge's own activity clock, not a start time typed into Settings.
  // Pressing start on the device is what begins the session, so elapsed
  // starts from zero there - previously it counted from the configured time
  // whether or not the tracker was even on, so a start that slipped by an
  // hour showed an hour already gone.
  //
  // Samples arrive in 5-minute batches, so the stored value is up to five
  // minutes behind. While the session is live that gap is real elapsed time
  // and gets added, which keeps the clock ticking second by second instead
  // of jumping in five-minute steps. Once it isn't live the value stands
  // exactly as the device last reported it - that's the finalisation: no
  // extrapolating a clock for a bike that stopped.
  //
  // Only elapsed is extrapolated, never timerS: elapsed advances with the
  // wall clock, moving time only advances while actually moving, and
  // guessing at the difference is how a stopped rider accrues moving time.
  const deviceElapsedS = telemetry?.progress.elapsed_s ?? null;
  // age_s is how old the reading was when the server answered; the rest is
  // how long ago that answer arrived here. Together they carry the clock
  // forward from the device's last known value, once a second, instead of
  // standing still for five minutes and then jumping.
  const sinceSampleS =
    sessionIsLive && telemetry?.live.age_s != null
      ? Math.max(0, telemetry.live.age_s + (nowMs - telemetryAt) / 1000)
      : 0;
  const elapsedSeconds = deviceElapsedS != null ? deviceElapsedS + sinceSampleS : null;
  const currentPace = data.simulatedKmh ?? currentPaceKmh(data.history);
  const averagePace = elapsedSeconds && elapsedSeconds > 0 ? coveredKm / (elapsedSeconds / 3600) : null;
  const requiredPaceKmh = data.targetSeconds && totalKm > 0 ? totalKm / (data.targetSeconds / 3600) : null;

  const expectedElapsedAtCovered = requiredPaceKmh ? (coveredKm / requiredPaceKmh) * 3600 : null;
  const aheadBySeconds =
    expectedElapsedAtCovered != null && elapsedSeconds != null ? expectedElapsedAtCovered - elapsedSeconds : null;

  const projectedFinishSeconds =
    currentPace && currentPace > 0 && elapsedSeconds != null ? elapsedSeconds + (remainingKm / currentPace) * 3600 : null;
  const projectedVsTarget =
    projectedFinishSeconds != null && data.targetSeconds != null ? data.targetSeconds - projectedFinishSeconds : null;

  const effectiveLayout = layout ?? DEFAULT_LAYOUT;

  // The canvas is an absolutely-positioned arrangement saved in raw pixels,
  // so a window narrower than the arrangement simply cut off whatever stuck
  // out past the right edge - and .canvas never scrolls sideways, so the
  // clipped part was unreachable, not just unseen. An iPad in landscape is
  // 1366px wide and lands in the "desktop" category, which is how a layout
  // arranged at 1480px wide left the donation card hanging 162px off the
  // screen with no way to scroll to it.
  //
  // Rather than shuffling widgets around (rescueOffCanvasX's approach for
  // the dashboard, which preserves reachability but not the arrangement),
  // the whole thing is scaled down uniformly to fit the width available.
  // The layout Malcolm arranged is kept exactly as designed, just smaller.
  // On a window at least as wide as the arrangement this is 1 and nothing
  // changes at all.
  const naturalWidth = effectiveLayout.order.reduce(
    (max, id) => Math.max(max, effectiveLayout.rects[id].x + effectiveLayout.rects[id].width),
    0,
  );
  const fit = !stacked && naturalWidth > 0 && canvasWidth > 0 ? Math.min(1, canvasWidth / naturalWidth) : 1;
  // Scaling is applied to the rects handed to each widget rather than as a
  // CSS transform on the canvas: a transformed ancestor becomes the
  // containing block for position:fixed descendants, which would trap the
  // map's full-screen mode inside the canvas box instead of filling the
  // viewport. It also keeps text crisp and leaves Leaflet's pointer
  // coordinates untouched.
  const scaleRect = (rect: LiveTrackerRect): LiveTrackerRect => ({
    x: Math.round(rect.x * fit),
    y: Math.round(rect.y * fit),
    width: Math.round(rect.width * fit),
    height: Math.round(rect.height * fit),
  });

  const canvasHeight = computeCanvasHeight(
    effectiveLayout.order.map((id) => {
      const rect = scaleRect(effectiveLayout.rects[id]);
      return { y: rect.y, height: rect.height };
    }),
  );

  const widgetContent: Record<LiveWidgetId, React.ReactNode> = {
    pace: (
      <div className={styles.paceCard}>
        <p className={styles.cardTitle}>Pace</p>
        <div className={styles.paceGrid}>
          <div className={styles.paceItem}>
            <p className={styles.paceLabel}>Current</p>
            <p className={styles.paceValue}>
              {currentPace != null ? currentPace.toFixed(1) : "—"}
              <span className={styles.statUnit}>km/h</span>
            </p>
          </div>
          <div className={styles.paceItem}>
            <p className={styles.paceLabel}>Average</p>
            <p className={styles.paceValue}>
              {averagePace != null ? averagePace.toFixed(1) : "—"}
              <span className={styles.statUnit}>km/h</span>
            </p>
          </div>
          <div className={styles.paceItem}>
            <p className={styles.paceLabel}>Required</p>
            <p className={styles.paceValue}>
              {requiredPaceKmh != null ? requiredPaceKmh.toFixed(1) : "—"}
              <span className={styles.statUnit}>km/h</span>
            </p>
          </div>
        </div>
        {/* This card used to carry a note explaining that live power, heart
            rate and cadence weren't shown because Garmin had no real-time
            channel for a personal project. That stopped being true when the
            Edge 1040 Connect IQ app in connectiq/edge-tracker started
            sending them: they're on the map now, under Data. */}
      </div>
    ),
    progress: (
      <div className={styles.progressCard}>
        <div className={styles.progressHeader}>
          <span className={styles.cardTitle}>Progress vs target</span>
          {data.targetSeconds != null && (
            <span className={styles.recordBadge}>Target: {formatDuration(data.targetSeconds)}</span>
          )}
        </div>
        <div className={styles.progressBarBg}>
          <div className={styles.progressBarFill} style={{ width: `${progressPct}%` }} />
        </div>
        <div className={styles.progressLabels}>
          <span>
            {coveredKm.toFixed(0)} km ({progressPct.toFixed(0)}%)
          </span>
          <span>{totalKm > 0 ? `${totalKm.toFixed(0)} km` : "—"}</span>
        </div>
        <div className={styles.progressSummary}>
          <span>
            Elapsed: <strong>{elapsedSeconds != null ? formatDuration(elapsedSeconds) : "—"}</strong>
          </span>
          <span>
            Remaining: <strong>{remainingKm.toFixed(0)} km</strong>
          </span>
          {aheadBySeconds != null && (
            <span>
              {aheadBySeconds >= 0 ? "Ahead by" : "Behind by"}: <strong>{formatDuration(Math.abs(aheadBySeconds))}</strong>
            </span>
          )}
        </div>
      </div>
    ),
    map: (
      <div className={styles.mapWrap}>
        {routeError && <p className={styles.empty}>Couldn&apos;t load the route GPX file.</p>}
        <LiveTrackerMap
          route={route}
          position={data.position}
          coveredKm={coveredKm}
          totalKm={totalKm}
          weather={weather}
          telemetry={telemetry}
          sessionState={data.tracking?.state ?? "pending"}
          sessionStartTs={data.tracking?.sessionStartTs ?? null}
          sessionEndTs={data.tracking?.sessionEndTs ?? null}
          aheadBySeconds={aheadBySeconds}
        />
      </div>
    ),
    eta: (
      <div
        className={`${styles.etaBox} ${
          projectedVsTarget == null ? "" : projectedVsTarget >= 0 ? styles.etaAhead : styles.etaBehind
        }`}
      >
        <p className={styles.etaLabel}>Projected finish (current pace)</p>
        <p className={styles.etaValue}>{projectedFinishSeconds != null ? formatDuration(projectedFinishSeconds) : "—"}</p>
        {projectedVsTarget != null && (
          <p className={styles.etaVs}>
            {projectedVsTarget >= 0 ? `${formatDuration(projectedVsTarget)} under target` : `${formatDuration(-projectedVsTarget)} over target`}
          </p>
        )}
      </div>
    ),
    // Same component as /the-cause - followers watching the attempt can
    // donate right from the page without navigating away.
    donate: <FundraiserProgress />,
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <img src="/logo.png" alt="" className={styles.logo} />
          <div>
            {/* Named after the route itself, so renaming it in Ride with
                GPS renames this page - no second place to remember to
                edit. Falls back to the generic heading only when the route
                hasn't loaded or carries no name of its own. */}
            <h1 className={styles.title}>{routeName ?? "World Record Attempt — Live"}</h1>
            {routeDescription && <p className={styles.subtitle}>{routeDescription}</p>}
            {data.startTime && (
              <p className={styles.startedLine}>
                Started {new Date(data.startTime).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
              </p>
            )}
          </div>
        </div>
        {/* Driven by whether samples are actually arriving, not by the
            configured start time. Before the tracker is switched on, and
            after it's switched off, this says so rather than showing a
            pulsing dot next to a position that stopped moving hours ago. */}
        <button
          type="button"
          className={styles.themeToggle}
          onClick={() => setMode(THEME_CYCLE[(THEME_CYCLE.indexOf(mode) + 1) % THEME_CYCLE.length])}
          aria-label={`Theme: ${THEME_LABEL[mode]}. Tap to change.`}
          title={`Theme: ${THEME_LABEL[mode]}`}
        >
          <span aria-hidden="true">{THEME_ICON[mode]}</span>
          <span className={styles.themeWord}>{THEME_LABEL[mode]}</span>
        </button>

        <div className={styles.status}>
          {data.tracking?.state === "live" ? (
            <>
              <span className={styles.liveDot} />
              <span className={styles.liveWord}>Live</span>
              {data.position && <span>· Updated {relativeSeconds(data.position.timestamp)}</span>}
            </>
          ) : (
            <>
              <span className={styles.idleDot} />
              <span>
                {data.tracking?.state === "ended"
                  ? "Ride finished"
                  : data.tracking?.state === "stalled"
                    ? `Signal lost · last seen ${relativeSeconds((data.tracking.lastSampleTs ?? 0) * 1000)}`
                    : "Tracker hasn't started"}
              </span>
            </>
          )}
        </div>
      </div>

      {data.isOwner && !data.visible && (
        <p className={styles.hiddenNotice}>
          This page is hidden from visitors right now - only you can see it. Turn it back on from Settings whenever
          you&apos;re ready.
        </p>
      )}

      <main
        ref={canvasRef}
        className={stacked ? styles.stackList : `${styles.canvas} ${isResizing ? styles.canvasSnap : ""}`}
        style={stacked ? undefined : { height: canvasHeight }}
      >
        {effectiveLayout.order.map((id, index) => {
          // Scaled for rendering; the drag/resize callbacks below divide
          // back out so what gets saved is always in the layout's own
          // full-size coordinates, not whatever this window happened to
          // shrink them to.
          const rect = scaleRect(effectiveLayout.rects[id]);
          const minSize = {
            minWidth: Math.round(MIN_SIZE[id].minWidth * fit),
            minHeight: Math.round(MIN_SIZE[id].minHeight * fit),
          };
          const reorderProps = stacked
            ? {
                stacked: true as const,
                canMoveUp: index > 0,
                canMoveDown: index < effectiveLayout.order.length - 1,
                onReorder: (direction: "up" | "down") => handleReorder(id, direction),
              }
            : {};
          return (
            <LiveTrackerWidget
              key={id}
              {...rect}
              {...minSize}
              interactive={data.isOwner}
              onMove={(x, y) => handleMove(id, Math.round(x / fit), Math.round(y / fit))}
              onResize={(width, height) => handleResize(id, Math.round(width / fit), Math.round(height / fit))}
              onResizingChange={setIsResizing}
              {...reorderProps}
            >
              {widgetContent[id]}
            </LiveTrackerWidget>
          );
        })}
      </main>
    </div>
  );
}
