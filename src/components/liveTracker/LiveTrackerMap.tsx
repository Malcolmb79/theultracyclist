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

// Mirrors the parts of api/live.json.ts's response the map reads -
// duplicated per this project's api/src decoupling convention, same as
// LiveTrackerPage does for api/live-tracker.ts.
export type LiveTelemetry = {
  live: {
    stale: boolean;
    // Seconds since the Edge's newest sample. Never near zero in normal
    // operation: Connect IQ won't fire the background temporal event that
    // sends them more often than every 5 minutes, so these readings cycle
    // between fresh and ~5 minutes old and the card says which.
    age_s: number | null;
    speed_mps: number | null;
    avg_speed_elapsed_mps: number | null;
    avg_speed_moving_mps: number | null;
    power_30s_w: number | null;
    power_avg_w: number | null;
    power_np_w: number | null;
    hr_bpm: number | null;
    hr_5min_bpm: number | null;
    cad_rpm: number | null;
    alt_m: number | null;
    batt_pct: number | null;
  };
  progress: {
    distance_m: number | null;
    elapsed_s: number | null;
    timer_s: number | null;
  };
} | null;

export type TelemetryFieldId =
  | "speed"
  | "avgSpeedMoving"
  | "avgSpeedElapsed"
  | "power"
  | "powerAvg"
  | "powerNp"
  | "hr"
  | "hr5min"
  | "cadence"
  | "altitude"
  | "distance"
  | "elapsed"
  | "moving"
  | "battery";

// Age of the Edge readings, for the caption on the telemetry card. Under a
// minute reads as "now" rather than a jittery second count - the underlying
// feed arrives in 5-minute batches, so second-level precision here would be
// false precision.
function formatAge(seconds: number): string {
  if (seconds < 60) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

// Every field the Edge 1040 Connect IQ app actually sends, and nothing
// else - the app's compute() writes lat/lon/alt_m/dist_m/elapsed_s/
// timer_s/speed_mps/power_w/hr_bpm/cad_rpm/batt_pct (see
// connectiq/edge-tracker/source/EdgeTrackerView.mc), and the rolling
// averages here are derived from those same columns server-side in
// api/live.json.ts rather than in the browser. Nothing is shown that the
// device doesn't measure.
//
// `value` returns null whenever the reading is missing - a dropped HR
// strap or a cadence sensor that never paired shows "—" rather than
// being silently dropped from the card, so an enabled field never just
// vanishes without explanation.
const TELEMETRY_FIELDS: {
  id: TelemetryFieldId;
  label: string;
  short: string;
  unit: string;
  value: (t: NonNullable<LiveTelemetry>) => number | string | null;
}[] = [
  { id: "speed", label: "Speed", short: "Speed", unit: "km/h", value: (t) => (t.live.speed_mps == null ? null : (t.live.speed_mps * 3.6).toFixed(1)) },
  { id: "power", label: "Power (30s)", short: "Power", unit: "W", value: (t) => t.live.power_30s_w },
  { id: "hr", label: "Heart rate", short: "HR", unit: "bpm", value: (t) => t.live.hr_bpm },
  { id: "cadence", label: "Cadence", short: "Cadence", unit: "rpm", value: (t) => t.live.cad_rpm },
  { id: "powerNp", label: "Normalised power", short: "NP", unit: "W", value: (t) => t.live.power_np_w },
  { id: "powerAvg", label: "Power (ride avg)", short: "Avg P", unit: "W", value: (t) => t.live.power_avg_w },
  { id: "hr5min", label: "Heart rate (5 min)", short: "HR 5m", unit: "bpm", value: (t) => t.live.hr_5min_bpm },
  { id: "altitude", label: "Altitude", short: "Altitude", unit: "m", value: (t) => (t.live.alt_m == null ? null : Math.round(t.live.alt_m)) },
  { id: "avgSpeedMoving", label: "Avg speed (moving)", short: "Avg mov", unit: "km/h", value: (t) => (t.live.avg_speed_moving_mps == null ? null : (t.live.avg_speed_moving_mps * 3.6).toFixed(1)) },
  { id: "avgSpeedElapsed", label: "Avg speed (elapsed)", short: "Avg elap", unit: "km/h", value: (t) => (t.live.avg_speed_elapsed_mps == null ? null : (t.live.avg_speed_elapsed_mps * 3.6).toFixed(1)) },
  // The Edge's own odometer, not the GPX-derived figure the Progress card
  // shows - trackerDb.ts treats the device's distance as authoritative and
  // never recomputes it, so the two can differ slightly. Off by default so
  // the page doesn't put two distances on screen unless asked.
  { id: "distance", label: "Distance (device)", short: "Distance", unit: "km", value: (t) => (t.progress.distance_m == null ? null : (t.progress.distance_m / 1000).toFixed(1)) },
  { id: "elapsed", label: "Elapsed", short: "Elapsed", unit: "", value: (t) => (t.progress.elapsed_s == null ? null : formatClock(t.progress.elapsed_s)) },
  { id: "moving", label: "Moving time", short: "Moving", unit: "", value: (t) => (t.progress.timer_s == null ? null : formatClock(t.progress.timer_s)) },
  { id: "battery", label: "Edge battery", short: "Battery", unit: "%", value: (t) => t.live.batt_pct },
];

// The four a dot-watcher actually wants at a glance. The rest are one tap
// away rather than crowding the map by default.
const DEFAULT_FIELDS: TelemetryFieldId[] = ["speed", "power", "hr", "cadence"];

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
  telemetry: LiveTelemetry;
  // Samples arriving right now. Drives the LIVE badge, which is deliberately
  // absent rather than greyed when nothing is coming in - a permanent badge
  // that only changes colour still reads as "live" at a glance.
  trackingActive: boolean;
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
export default function LiveTrackerMap({
  route,
  position,
  coveredKm,
  totalKm,
  weather,
  telemetry,
  trackingActive,
}: LiveTrackerMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const fullLineRef = useRef<Polyline | null>(null);
  const completedLineRef = useRef<Polyline | null>(null);
  const markerRef = useRef<CircleMarker | null>(null);
  const hasFitBoundsRef = useRef(false);
  const [showProfile, setShowProfile] = useState(true);
  const [showWeather, setShowWeather] = useState(true);
  // Whether the per-field chip row is open, kept separate from whether any
  // fields are on: closing the picker shouldn't switch off the readings
  // you just chose, and the card stays up on its own.
  const [showFieldPicker, setShowFieldPicker] = useState(false);
  const [fields, setFields] = useState<TelemetryFieldId[]>(DEFAULT_FIELDS);
  const [expanded, setExpanded] = useState(false);
  const [zoom, setZoom] = useState(INITIAL_ZOOM);
  const [scaleKm, setScaleKm] = useState<number | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    const resizeObserver = new ResizeObserver(() => mapRef.current?.invalidateSize());
    resizeObserver.observe(containerRef.current);

    import("leaflet").then((L) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      // zoomControl: false because this map already has its own −/slider/+
      // with a km scale readout, so Leaflet's default control was a second
      // way to do the same thing - and a harmful one: Leaflet renders its
      // controls at z-index 1000, above every overlay here (all 500), so
      // the top-left corner it occupies silently swallowed taps meant for
      // anything placed there. Freeing that corner is what makes room for
      // the telemetry card, and on a phone for the weather card too.
      const map = L.map(containerRef.current, { minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM, zoomControl: false }).setView(
        [53.4, -8],
        INITIAL_ZOOM,
      );
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

  // Full screen is done by pinning .wrap to the viewport rather than
  // through the Fullscreen API: iPhone Safari doesn't implement
  // requestFullscreen on elements at all (only on <video>), and the phone
  // is where a bigger map matters most. A fixed overlay behaves the same
  // on every browser, and the map's own ResizeObserver picks up the size
  // change and calls invalidateSize for free.
  //
  // The page behind it is locked while expanded - without that, dragging
  // near the edge of the map scrolls the page underneath on touch.
  useEffect(() => {
    if (!expanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [expanded]);

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
  // True compass direction the wind is blowing TO, not rotated relative to
  // the cyclist's course - this map is fixed north-up (it never rotates to
  // face the direction of travel), so an arrow drawn relative to course
  // would only make visual sense on a heading-up map. Drawing it in true
  // compass orientation instead means it can be read directly against the
  // map itself (matches the route line's visible direction on screen) and
  // cross-checked against any other wind-direction source. The headwind/
  // tailwind/crosswind label above still does the course-relative
  // classification - that's the part that's actually "relative to the
  // direction the cyclist is travelling", the arrow is what makes it
  // checkable.
  const arrowRotation = windFrom != null ? normalizeAngle(windFrom + 180) : 0;

  return (
    // profileOpen is only read by the phone media query, which moves the
    // zoom slider to the bottom edge and needs to know whether the
    // elevation panel is currently occupying it.
    <div className={`${styles.wrap} ${showProfile ? styles.profileOpen : ""} ${expanded ? styles.expanded : ""}`}>
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

      {/* Controls, the field picker and the weather card share one
          right-hand column so they stack instead of being pinned at fixed
          offsets - the picker's height depends on how many chips wrap, so
          anything below it can't be placed with a magic number. */}
      <div className={styles.rightStack}>
      {trackingActive && (
        <div className={styles.liveBadge}>
          <span className={styles.liveBadgeDot} />
          Live
        </div>
      )}
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
        <button
          type="button"
          className={`${styles.controlButton} ${showFieldPicker ? styles.controlButtonActive : ""}`}
          onClick={() => setShowFieldPicker((v) => !v)}
          aria-pressed={showFieldPicker}
          aria-label="Choose which ride data to show"
        >
          Data
        </button>
        {/* Icon-only: the row already carries four worded buttons, and a
            fifth wouldn't fit beside the telemetry card on a ~390px
            phone. */}
        <button
          type="button"
          className={`${styles.controlButton} ${styles.expandButton} ${expanded ? styles.controlButtonActive : ""}`}
          onClick={() => setExpanded((v) => !v)}
          aria-pressed={expanded}
          aria-label={expanded ? "Exit full screen" : "Show map full screen"}
          title={expanded ? "Exit full screen" : "Full screen"}
        >
          {expanded ? "✕" : "⛶"}
        </button>
      </div>

      {/* One chip per field the Edge sends. Wraps, and sits below the
          control row rather than in it - twelve more buttons in that row
          would take four lines across the top of a phone-sized map. */}
      {showFieldPicker && (
        <div className={styles.fieldPicker}>
          {TELEMETRY_FIELDS.map((field) => {
            const on = fields.includes(field.id);
            return (
              <button
                key={field.id}
                type="button"
                className={`${styles.fieldChip} ${on ? styles.fieldChipOn : ""}`}
                aria-pressed={on}
                title={field.label}
                onClick={() =>
                  setFields((current) =>
                    current.includes(field.id) ? current.filter((f) => f !== field.id) : [...current, field.id],
                  )
                }
              >
                {field.short}
              </button>
            );
          })}
        </div>
      )}

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
      </div>

      {/* Left-hand column, opposite the controls. Rendered in
          TELEMETRY_FIELDS order rather than the order fields were switched
          on, so the card doesn't reshuffle itself as you toggle. */}
      {fields.length > 0 && telemetry && (
        <div className={`${styles.telemetryCard} ${telemetry.live.stale ? styles.telemetryStale : ""}`}>
          {/* Always captioned, not just when stale. These numbers arrive in
              5-minute batches, so a card that only ever says something when
              things go wrong reads as "current" the rest of the time - when
              what it means is "as of a few minutes ago". */}
          {telemetry.live.age_s != null && (
            <p className={telemetry.live.stale ? styles.telemetryStaleNote : styles.telemetryAge}>
              {telemetry.live.stale ? "Last known" : formatAge(telemetry.live.age_s)}
            </p>
          )}
          {TELEMETRY_FIELDS.filter((field) => fields.includes(field.id)).map((field) => {
            const value = field.value(telemetry);
            return (
              <div key={field.id} className={styles.telemetryRow}>
                <span className={styles.telemetryLabel}>{field.short}</span>
                <span className={styles.telemetryValue}>
                  {value ?? "—"}
                  {value != null && field.unit && <span className={styles.telemetryUnit}>{field.unit}</span>}
                </span>
              </div>
            );
          })}
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
