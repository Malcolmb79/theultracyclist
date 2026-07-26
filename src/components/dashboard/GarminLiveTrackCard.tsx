import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Polyline, CircleMarker } from "leaflet";
import "leaflet/dist/leaflet.css";
import styles from "./GarminLiveTrackCard.module.css";

const POLL_INTERVAL_MS = 30_000;
const TRACK_COLOR = "#4B87F5";

type LiveTrackPoint = {
  lat: number;
  lon: number;
  timestamp: number;
  distanceKm: number | null;
  elevationM: number | null;
  speedKmh: number | null;
};

// Mirrors api/garmin-livetrack.ts's response shape - duplicated rather than
// imported, matching how this project keeps its api/ and src/ TypeScript
// projects decoupled (see coaching-narrative.ts's NarrativeInput for the
// same pattern elsewhere).
type LiveTrackState =
  | { status: "loading" }
  | { status: "notConfigured" }
  | { status: "invalidUrl" }
  | { status: "error"; message: string }
  | { status: "ready"; points: LiveTrackPoint[] };

function relativeSeconds(timestampMs: number): string {
  const diffSec = Math.round((Date.now() - timestampMs) / 1000);
  if (diffSec < 60) return `${Math.max(0, diffSec)}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  return `${Math.round(diffMin / 60)}h ago`;
}

// Live position + track for the athlete's currently pasted Garmin LiveTrack
// session (see Settings) - built against Garmin's undocumented LiveTrack
// endpoint (api/garmin-livetrack.ts), confirmed live against a real session
// on 2026-07-26. That session had zero recorded points, so the individual
// point field names are still a best-effort guess (extractPoint in the API
// route tries several plausible spellings) - may need a small fix once
// there's a session with real points to check against.
//
// Uses plain Leaflet rather than react-leaflet so the map instance persists
// across polls (only its data updates), so panning/zooming while watching
// doesn't get reset every 30 seconds. Leaflet is dynamically imported since
// most widget catalog entries never render this component at all - no
// reason to ship its bundle to every page load.
export default function GarminLiveTrackCard() {
  const [state, setState] = useState<LiveTrackState>({ status: "loading" });
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const lineRef = useRef<Polyline | null>(null);
  const markerRef = useRef<CircleMarker | null>(null);
  const hasFitBoundsRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      fetch("/api/garmin-livetrack")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Request failed"))))
        .then((data: LiveTrackState) => {
          if (!cancelled) setState(data);
        })
        .catch(() => {
          if (!cancelled) setState({ status: "error", message: "Couldn't load LiveTrack data." });
        });
    };

    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Map setup, once on mount - the current-position marker uses a plain
  // circleMarker rather than Leaflet's default pin icon, since the default
  // icon's image paths break under Vite's bundling unless manually patched;
  // a circle sidesteps that entirely.
  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    const resizeObserver = new ResizeObserver(() => mapRef.current?.invalidateSize());
    resizeObserver.observe(containerRef.current);

    import("leaflet").then((L) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const map = L.map(containerRef.current).setView([0, 0], 2);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);
      lineRef.current = L.polyline([], { color: TRACK_COLOR, weight: 3 }).addTo(map);
      markerRef.current = L.circleMarker([0, 0], {
        radius: 7,
        color: "#fff",
        weight: 2,
        fillColor: TRACK_COLOR,
        fillOpacity: 1,
      }).addTo(map);
      mapRef.current = map;
    });

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Data updates move the existing polyline/marker rather than recreating
  // the map - bounds are only fitted once, on the first points received,
  // so the athlete's own pan/zoom isn't yanked back on every poll.
  useEffect(() => {
    if (state.status !== "ready" || state.points.length === 0 || !mapRef.current || !lineRef.current || !markerRef.current) return;
    import("leaflet").then((L) => {
      if (!lineRef.current || !markerRef.current || !mapRef.current) return;
      const latLngs = state.points.map((p) => L.latLng(p.lat, p.lon));
      lineRef.current.setLatLngs(latLngs);
      markerRef.current.setLatLng(latLngs[latLngs.length - 1]);
      if (!hasFitBoundsRef.current) {
        mapRef.current.fitBounds(lineRef.current.getBounds(), { padding: [24, 24] });
        hasFitBoundsRef.current = true;
      }
    });
  }, [state]);

  const latest = state.status === "ready" && state.points.length > 0 ? state.points[state.points.length - 1] : null;

  const overlayMessage =
    state.status === "loading"
      ? "Loading…"
      : state.status === "notConfigured"
        ? "No LiveTrack URL set - paste one in Settings before starting a session."
        : state.status === "invalidUrl"
          ? "That LiveTrack URL doesn't look right - check it in Settings."
          : state.status === "error"
            ? state.message
            : state.status === "ready" && state.points.length === 0
              ? "No position data yet - this updates automatically once the session reports one."
              : null;

  return (
    <div className={styles.wrap}>
      <div className={styles.mapWrap}>
        <div ref={containerRef} className={styles.map} />
        {overlayMessage && (
          <div className={styles.overlay}>
            <p className={styles.empty}>{overlayMessage}</p>
          </div>
        )}
      </div>
      {latest && (
        <div className={styles.stats}>
          {latest.distanceKm != null && (
            <div className={styles.stat}>
              <span className={styles.statValue}>{latest.distanceKm.toFixed(1)} km</span>
              <span className={styles.statLabel}>Distance</span>
            </div>
          )}
          {latest.speedKmh != null && (
            <div className={styles.stat}>
              <span className={styles.statValue}>{Math.round(latest.speedKmh)} km/h</span>
              <span className={styles.statLabel}>Speed</span>
            </div>
          )}
          <div className={styles.stat}>
            <span className={styles.statValue}>{relativeSeconds(latest.timestamp)}</span>
            <span className={styles.statLabel}>Last update</span>
          </div>
        </div>
      )}
    </div>
  );
}
