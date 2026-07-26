import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Polyline, CircleMarker } from "leaflet";
import "leaflet/dist/leaflet.css";
import { courseBearingAtKm, type RoutePoint } from "../../utils/gpxRoute";
import RouteProfile from "./RouteProfile";
import styles from "./LiveTrackerMap.module.css";

const ROUTE_COLOR = "#3b82f6";
const COMPLETED_COLOR = "#22c55e";
const LIVE_COLOR = "#ef4444";
// Close enough to see local roads/towns around the live position without
// needing to manually zoom back in after panning or zooming away - matches
// roughly what "recenter" implies for a dot-watching page like this.
const RESET_ZOOM = 12;
const INITIAL_ZOOM = 7;
// 3 (most of Ireland) to 18 (street-level) - the tile source's own maxZoom
// is 19, but 18 is already past what's useful for a route this size, and
// leaves one zoom level of headroom before tiles visibly blur.
const MIN_ZOOM = 3;
const MAX_ZOOM = 18;

type WeatherState = { temp: number; windSpeed: number; windDirection: number; code: number } | null;
type WindClass = "headwind" | "tailwind" | "crosswind";

function normalizeAngle(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

// Signed angular difference a-b, normalized to (-180, 180].
function angleDiff(a: number, b: number): number {
  return ((a - b + 540) % 360) - 180;
}

// relativeFromAngle is the wind's "from" direction relative to the
// cyclist's course (0 = wind coming from directly ahead, ±180 = from
// directly behind).
function windClassification(relativeFromAngle: number): WindClass {
  const abs = Math.abs(relativeFromAngle);
  if (abs <= 45) return "headwind";
  if (abs >= 135) return "tailwind";
  return "crosswind";
}

const WIND_CLASS_LABEL: Record<WindClass, string> = {
  headwind: "Headwind",
  tailwind: "Tailwind",
  crosswind: "Crosswind",
};

const EARTH_CIRCUMFERENCE_M = 40_075_016.686;

// Standard Web Mercator ground resolution formula (256px tiles, so the
// whole 360° wraps in 2^(zoom+8) px) - meters/pixel shrinks toward the
// poles at a given zoom, hence the latitude term.
function metersPerPixel(latDeg: number, zoomLevel: number): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos((latDeg * Math.PI) / 180)) / 2 ** (zoomLevel + 8);
}

// Readable rounding that still tracks the real number reasonably closely
// (unlike snapping to a fixed 1/2/5 x 10^n scale-bar convention, which at
// this route's zoomed-out starting scale would round ~650km down to
// 500km) - whole km under 100, nearest 5 under 1000, nearest 50 beyond.
function roundKm(km: number): number {
  if (km < 100) return Math.round(km);
  if (km < 1000) return Math.round(km / 5) * 5;
  return Math.round(km / 50) * 50;
}

function formatScaleKm(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km} km`;
}

interface LiveTrackerMapProps {
  route: RoutePoint[];
  position: { lat: number; lon: number } | null;
  coveredKm: number;
  totalKm: number;
  weather: WeatherState;
}

// Plain Leaflet (not react-leaflet) so the map instance persists across
// polls - only the polylines/marker move, panning/zooming isn't reset on
// every update. Same pattern as the Garmin LiveTrack widget's map before it
// was replaced with an iframe embed - this page needs the raw route/position
// data (for the progress bar, ETA, etc.), so a custom map is the right call
// here even though it wasn't for that widget.
//
// Also owns the weather overlay (instead of a separate widget - keeping
// wind conditions right next to the position they apply to) and an
// optional elevation-profile panel, both rendered as plain HTML siblings of
// the Leaflet container rather than Leaflet controls, since they need
// React state/props anyway.
export default function LiveTrackerMap({ route, position, coveredKm, totalKm, weather }: LiveTrackerMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const fullLineRef = useRef<Polyline | null>(null);
  const completedLineRef = useRef<Polyline | null>(null);
  const markerRef = useRef<CircleMarker | null>(null);
  const hasFitBoundsRef = useRef(false);
  const [showProfile, setShowProfile] = useState(true);
  const [showWeather, setShowWeather] = useState(true);
  const [zoom, setZoom] = useState(INITIAL_ZOOM);
  const [scaleKm, setScaleKm] = useState<number | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    const resizeObserver = new ResizeObserver(() => mapRef.current?.invalidateSize());
    resizeObserver.observe(containerRef.current);

    import("leaflet").then((L) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const map = L.map(containerRef.current, { minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM }).setView([53.4, -8], INITIAL_ZOOM);
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
        subdomains: "abcd",
        maxZoom: 19,
      }).addTo(map);
      fullLineRef.current = L.polyline([], { color: ROUTE_COLOR, weight: 4, opacity: 0.6 }).addTo(map);
      completedLineRef.current = L.polyline([], { color: COMPLETED_COLOR, weight: 5, opacity: 0.9 }).addTo(map);
      markerRef.current = L.circleMarker([0, 0], {
        radius: 8,
        color: "#fff",
        weight: 2,
        fillColor: LIVE_COLOR,
        fillOpacity: 1,
      }).addTo(map);
      // Keeps the slider and the km scale readout in sync with zooming/
      // panning/resizing done any other way (scroll wheel, pinch, double-
      // click, the map's own +/- control, dragging, the widget itself being
      // resized) - the slider isn't the only way to change zoom, and ground
      // distance-per-pixel also depends on latitude (Web Mercator) and the
      // container's actual pixel width, so panning or resizing needs a
      // recompute even at a fixed zoom. The readout is the full visible map
      // width in km (not a fixed-length scale-bar reference), so at the
      // route's full-length starting view it reads close to the route's
      // own ~600km span rather than some arbitrary smaller number.
      const updateScale = () => {
        setZoom(map.getZoom());
        const raw = (metersPerPixel(map.getCenter().lat, map.getZoom()) * map.getSize().x) / 1000;
        setScaleKm(roundKm(raw));
      };
      map.on("zoomend moveend resize", updateScale);
      updateScale();
      mapRef.current = map;
    });

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
      hasFitBoundsRef.current = false;
    };
  }, []);

  // Route line + initial bounds fit, once the route loads.
  useEffect(() => {
    if (route.length === 0 || !mapRef.current || !fullLineRef.current) return;
    import("leaflet").then((L) => {
      if (!fullLineRef.current || !mapRef.current) return;
      const latLngs = route.map((p) => L.latLng(p.lat, p.lon));
      fullLineRef.current.setLatLngs(latLngs);
      if (!hasFitBoundsRef.current) {
        mapRef.current.fitBounds(fullLineRef.current.getBounds(), { padding: [24, 24] });
        hasFitBoundsRef.current = true;
      }
    });
  }, [route]);

  // Completed-so-far highlight + live marker, on every position update.
  useEffect(() => {
    if (!position || route.length === 0 || !completedLineRef.current || !markerRef.current) return;
    import("leaflet").then((L) => {
      if (!completedLineRef.current || !markerRef.current) return;
      const completed = route.filter((p) => p.distanceKm <= coveredKm).map((p) => L.latLng(p.lat, p.lon));
      completedLineRef.current.setLatLngs(completed);
      markerRef.current.setLatLng([position.lat, position.lon]);
    });
  }, [position, route, coveredKm]);

  const handleReset = () => {
    if (mapRef.current && position) {
      mapRef.current.setView([position.lat, position.lon], RESET_ZOOM);
    }
  };

  // Slider drives the map, not the other way around, except for the
  // zoomend/moveend listener above keeping it honest when zoom changes some
  // other way. Re-centers on the live dot (when we have one) rather than
  // just zooming in place, so dragging the slider never leaves the dot
  // drifting toward an edge or off-screen - organic zoom gestures (scroll/
  // pinch/double-click) are left alone and zoom around wherever the user
  // is actually looking, only the slider forces a recenter.
  const handleZoomChange = (next: number) => {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    setZoom(clamped);
    if (!mapRef.current) return;
    if (position) {
      mapRef.current.setView([position.lat, position.lon], clamped);
    } else {
      mapRef.current.setZoom(clamped);
    }
  };

  const courseBearing = route.length > 1 ? courseBearingAtKm(route, coveredKm) : null;
  const windFrom = weather?.windDirection ?? null;
  const relativeFromAngle = windFrom != null && courseBearing != null ? angleDiff(windFrom, courseBearing) : null;
  const windClass = relativeFromAngle != null ? windClassification(relativeFromAngle) : null;
  const arrowRotation = windFrom != null ? normalizeAngle(windFrom + 180 - (courseBearing ?? 0)) : 0;

  return (
    <div className={styles.wrap}>
      <div ref={containerRef} className={styles.map} />

      <div className={styles.zoomSlider}>
        <button
          type="button"
          className={styles.zoomStepButton}
          onClick={() => handleZoomChange(zoom - 1)}
          disabled={zoom <= MIN_ZOOM}
          aria-label="Zoom out"
        >
          −
        </button>
        <input
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={1}
          value={zoom}
          onChange={(e) => handleZoomChange(Number(e.target.value))}
          aria-label="Map zoom level"
        />
        <button
          type="button"
          className={styles.zoomStepButton}
          onClick={() => handleZoomChange(zoom + 1)}
          disabled={zoom >= MAX_ZOOM}
          aria-label="Zoom in"
        >
          +
        </button>
        {scaleKm != null && <span className={styles.scaleValue}>{formatScaleKm(scaleKm)}</span>}
      </div>

      <div className={styles.controls}>
        <button
          type="button"
          className={styles.controlButton}
          onClick={handleReset}
          disabled={!position}
          aria-label="Recenter on live position"
        >
          ◎ Reset
        </button>
        <button
          type="button"
          className={`${styles.controlButton} ${showProfile ? styles.controlButtonActive : ""}`}
          onClick={() => setShowProfile((v) => !v)}
          aria-pressed={showProfile}
        >
          Profile
        </button>
        <button
          type="button"
          className={`${styles.controlButton} ${showWeather ? styles.controlButtonActive : ""}`}
          onClick={() => setShowWeather((v) => !v)}
          aria-pressed={showWeather}
        >
          Weather
        </button>
      </div>

      {showWeather && weather && (
        <div className={styles.weatherOverlay}>
          <p className={styles.weatherTemp}>{weather.temp}°C</p>
          <div className={styles.windRow}>
            <svg
              className={styles.windArrow}
              style={{ transform: `rotate(${arrowRotation}deg)` }}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path d="M12 2 L12 22 M12 2 L6 9 M12 2 L18 9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div>
              <p className={styles.windSpeed}>{weather.windSpeed} km/h</p>
              <p className={styles.windClass}>{windClass ? WIND_CLASS_LABEL[windClass] : "Wind"}</p>
            </div>
          </div>
        </div>
      )}

      {showProfile && (
        <div className={styles.profilePanel}>
          <RouteProfile route={route} coveredKm={coveredKm} totalKm={totalKm} />
        </div>
      )}
    </div>
  );
}
