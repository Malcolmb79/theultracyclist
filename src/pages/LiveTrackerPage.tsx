import { useEffect, useRef, useState } from "react";
import LiveTrackerMap from "../components/liveTracker/LiveTrackerMap";
import LiveTrackerWidget from "../components/liveTracker/LiveTrackerWidget";
import FundraiserProgress from "../components/fundraiser/FundraiserProgress";
import { fetchRoute, distanceCoveredKm, totalDistanceKm, haversineKm, type RoutePoint } from "../utils/gpxRoute";
import { useDeviceCategory } from "../utils/useDeviceCategory";
import { computeCanvasHeight } from "../utils/useCanvasItem";
import { useDashboardTheme } from "../utils/useDashboardTheme";
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
  layout: LiveTrackerLayout | null;
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
// most recent points. Only valid for a real feed: history[].timestamp is
// real wall-clock time, but api/live-tracker.ts's simulation advances
// distance ~120x faster than that real time suggests, so this same math
// would report a wildly inflated speed during a test run - see
// data.simulatedKmh, which the caller uses instead whenever a simulation
// is active.
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
// Deliberately has no live power/HR/cadence tiles - there's no channel
// available for that (Garmin's Connect API is suspended for new signups
// and isn't real-time even when open; LiveTrack's own page doesn't surface
// performance data either). Showing fabricated numbers there would
// actively mislead real followers watching a real attempt, so those tiles
// are left out entirely rather than faked.
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
export default function LiveTrackerPage() {
  useDashboardTheme();
  const [data, setData] = useState<ApiResult | null>(null);
  const [route, setRoute] = useState<RoutePoint[]>([]);
  const [routeError, setRouteError] = useState(false);
  const [weather, setWeather] = useState<WeatherState>(null);
  const [layout, setLayout] = useState<LiveTrackerLayout | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const layoutSeeded = useRef(false);
  const device = useDeviceCategory();
  const stacked = device !== "desktop";

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/live-tracker")
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
  }, []);

  useEffect(() => {
    if (!data?.gpxUrl) return;
    let cancelled = false;
    setRouteError(false);
    fetchRoute(data.gpxUrl)
      .then((r) => {
        if (!cancelled) setRoute(r);
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

  const persistLayout = (next: LiveTrackerLayout) => {
    setLayout(next);
    fetch("/api/live-tracker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layout: next }),
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
  const elapsedSeconds = data.startTime ? (Date.now() - Date.parse(data.startTime)) / 1000 : null;
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
  const canvasHeight = computeCanvasHeight(
    effectiveLayout.order.map((id) => ({ y: effectiveLayout.rects[id].y, height: effectiveLayout.rects[id].height })),
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
        <p className={styles.noTelemetryNote}>
          Live power, heart rate, and cadence aren&apos;t shown - Garmin has no real-time data channel available for a
          personal project like this one.
        </p>
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
        <LiveTrackerMap route={route} position={data.position} coveredKm={coveredKm} totalKm={totalKm} weather={weather} />
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
            <h1 className={styles.title}>World Record Attempt — Live</h1>
            {data.startTime && (
              <p className={styles.subtitle}>
                Started {new Date(data.startTime).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
              </p>
            )}
          </div>
        </div>
        <div className={styles.status}>
          <span className={styles.liveDot} />
          {data.position ? `Updated ${relativeSeconds(data.position.timestamp)}` : "Waiting for position…"}
        </div>
      </div>

      <main
        className={stacked ? styles.stackList : `${styles.canvas} ${isResizing ? styles.canvasSnap : ""}`}
        style={stacked ? undefined : { height: canvasHeight }}
      >
        {effectiveLayout.order.map((id, index) => {
          const rect = effectiveLayout.rects[id];
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
              {...MIN_SIZE[id]}
              interactive={data.isOwner}
              onMove={(x, y) => handleMove(id, x, y)}
              onResize={(width, height) => handleResize(id, width, height)}
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
