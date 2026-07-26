import { useEffect, useState } from "react";
import LiveTrackerMap from "../components/liveTracker/LiveTrackerMap";
import { fetchRoute, distanceCoveredKm, totalDistanceKm, haversineKm, type RoutePoint } from "../utils/gpxRoute";
import styles from "./LiveTrackerPage.module.css";

const POLL_INTERVAL_MS = 20_000;
const WEATHER_INTERVAL_MS = 10 * 60_000;

type PositionPoint = { lat: number; lon: number; timestamp: number };

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
};

type WeatherState = { temp: number; windSpeed: number; windDirection: number; code: number } | null;

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
// most recent points.
function currentPaceKmh(history: PositionPoint[]): number | null {
  if (history.length < 2) return null;
  const a = history[history.length - 2];
  const b = history[history.length - 1];
  const hours = (b.timestamp - a.timestamp) / 3_600_000;
  if (hours <= 0) return null;
  return haversineKm(a, b) / hours;
}

// Public "dot-watching" page for the actual attempt, separate from the
// Microsoft-gated /dashboard app - no sign-in, meant to be shared with
// followers. Position comes from the athlete's Garmin inReach MapShare
// feed (api/live-tracker.ts), the route from a public GPX export, and
// weather from Open-Meteo at the athlete's current position (not the
// visitor's own location, unlike the dashboard's Weather widget).
//
// Deliberately has no live power/HR/cadence tiles - there's no channel
// available for that (Garmin's Connect API is suspended for new signups
// and isn't real-time even when open; LiveTrack's own page doesn't surface
// performance data either). Showing fabricated numbers there would
// actively mislead real followers watching a real attempt, so those tiles
// are left out entirely rather than faked.
export default function LiveTrackerPage() {
  const [data, setData] = useState<ApiResult | null>(null);
  const [route, setRoute] = useState<RoutePoint[]>([]);
  const [routeError, setRouteError] = useState(false);
  const [weather, setWeather] = useState<WeatherState>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/live-tracker")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Request failed"))))
        .then((body: ApiResult) => {
          if (!cancelled) setData(body);
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
  const pace = currentPaceKmh(data.history);
  const requiredPaceKmh = data.targetSeconds && totalKm > 0 ? totalKm / (data.targetSeconds / 3600) : null;

  const expectedElapsedAtCovered = requiredPaceKmh ? (coveredKm / requiredPaceKmh) * 3600 : null;
  const aheadBySeconds =
    expectedElapsedAtCovered != null && elapsedSeconds != null ? expectedElapsedAtCovered - elapsedSeconds : null;

  const projectedFinishSeconds =
    pace && pace > 0 && elapsedSeconds != null ? elapsedSeconds + (remainingKm / pace) * 3600 : null;
  const projectedVsTarget =
    projectedFinishSeconds != null && data.targetSeconds != null ? data.targetSeconds - projectedFinishSeconds : null;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>World Record Attempt — Live</h1>
          {data.startTime && (
            <p className={styles.subtitle}>
              Started {new Date(data.startTime).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
            </p>
          )}
        </div>
        <div className={styles.status}>
          <span className={styles.liveDot} />
          {data.position ? `Updated ${relativeSeconds(data.position.timestamp)}` : "Waiting for position…"}
        </div>
      </div>

      <div className={styles.statGrid}>
        <div className={styles.statCard}>
          <p className={styles.statLabel}>Speed</p>
          <p className={styles.statValue}>
            {pace != null ? pace.toFixed(1) : "—"}
            <span className={styles.statUnit}>km/h</span>
          </p>
        </div>
        <div className={styles.statCard}>
          <p className={styles.statLabel}>Distance covered</p>
          <p className={styles.statValue}>
            {coveredKm.toFixed(0)}
            <span className={styles.statUnit}>km</span>
          </p>
        </div>
        <div className={styles.statCard}>
          <p className={styles.statLabel}>Elapsed</p>
          <p className={styles.statValue} style={{ fontSize: "1.4rem" }}>
            {elapsedSeconds != null ? formatDuration(elapsedSeconds) : "—"}
          </p>
        </div>
        <div className={styles.statCard}>
          <p className={styles.statLabel}>Required pace</p>
          <p className={styles.statValue}>
            {requiredPaceKmh != null ? requiredPaceKmh.toFixed(1) : "—"}
            <span className={styles.statUnit}>km/h</span>
          </p>
        </div>
      </div>
      <p className={styles.noTelemetryNote}>
        Live power, heart rate, and cadence aren&apos;t shown - Garmin has no real-time data channel available for a
        personal project like this one.
      </p>

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
            Remaining: <strong>{remainingKm.toFixed(0)} km</strong>
          </span>
          {aheadBySeconds != null && (
            <span>
              {aheadBySeconds >= 0 ? "Ahead by" : "Behind by"}: <strong>{formatDuration(Math.abs(aheadBySeconds))}</strong>
            </span>
          )}
        </div>
      </div>

      <div className={styles.mainGrid}>
        <div className={styles.mapWrap}>
          {routeError && <p className={styles.empty}>Couldn&apos;t load the route GPX file.</p>}
          <LiveTrackerMap route={route} position={data.position} coveredKm={coveredKm} />
        </div>

        <div className={styles.sidePanel}>
          <div className={styles.etaBox}>
            <p className={styles.etaLabel}>Projected finish (current pace)</p>
            <p className={styles.etaValue}>{projectedFinishSeconds != null ? formatDuration(projectedFinishSeconds) : "—"}</p>
            {projectedVsTarget != null && (
              <p className={styles.etaVs}>
                {projectedVsTarget >= 0 ? `${formatDuration(projectedVsTarget)} under target` : `${formatDuration(-projectedVsTarget)} over target`}
              </p>
            )}
          </div>

          <div className={styles.weatherCard}>
            <p className={styles.cardTitle}>Weather at current position</p>
            {weather ? (
              <p className={styles.weatherLine}>
                {weather.temp}°C · Wind {weather.windSpeed} km/h
              </p>
            ) : (
              <p className={styles.empty}>—</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
