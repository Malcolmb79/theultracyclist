import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Polyline, Marker, TileLayer } from "leaflet";
import "leaflet/dist/leaflet.css";
import { courseBearingAtKm, type RoutePoint } from "../../utils/gpxRoute";
import { useStoredState } from "../../utils/useStoredState";
import { useTheme } from "../../context/ThemeContext";

// CARTO's matching light and dark basemaps. The dark one used to be pinned
// regardless of the page theme, on the reasoning that a map is a legend and
// legends don't reskin. That holds when the page is always dark; it doesn't
// once the page can be light, because the map is the largest thing on it -
// leaving it dark reads as a failed load rather than a deliberate choice.
const TILES: Record<"light" | "dark", string> = {
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  light: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
};
import RouteProfile from "./RouteProfile";
import styles from "./LiveTrackerMap.module.css";

const ROUTE_COLOR = "#3b82f6";
const COMPLETED_COLOR = "#22c55e";
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
    // Whole-ride figures from the head unit, as opposed to the rolling
    // windows above.
    avg_speed_mps: number | null;
    avg_power_ride_w: number | null;
    avg_hr_ride_bpm: number | null;
    total_ascent_m: number | null;
  };
  progress: {
    distance_m: number | null;
    elapsed_s: number | null;
    timer_s: number | null;
  };
} | null;

export type TelemetryFieldId =
  // The eight the athlete asked for, and the defaults.
  | "distance"
  | "elapsed"
  | "moving"
  | "avgSpeed"
  | "avgPower"
  | "powerNp"
  | "avgHr"
  | "ascent"
  // Still available under Data, off by default. Instantaneous readings are
  // of limited use here: samples arrive in 5-minute batches, so "current"
  // heart rate is a number from up to five minutes ago. Averages and totals
  // don't have that problem, which is why they lead.
  | "speed"
  | "power"
  | "hr"
  | "hr5min"
  | "cadence"
  | "altitude"
  | "avgSpeedElapsed"
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

// A margin against target, not a clock reading - so "1h 05m" rather than
// "1:05", which next to the elapsed time above it would be easy to misread
// as another absolute time. Under an hour it drops to minutes, and under a
// minute to seconds, because "0h 00m" reads as no data rather than as a
// dead heat.
function formatMargin(seconds: number): string {
  const total = Math.abs(Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m`;
  return `${total}s`;
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
  // The eight defaults, in the order they're shown.
  { id: "distance", label: "Distance", short: "Distance", unit: "km", value: (t) => (t.progress.distance_m == null ? null : (t.progress.distance_m / 1000).toFixed(1)) },
  { id: "elapsed", label: "Elapsed time", short: "Elapsed", unit: "", value: (t) => (t.progress.elapsed_s == null ? null : formatClock(t.progress.elapsed_s)) },
  { id: "moving", label: "Moving time", short: "Moving", unit: "", value: (t) => (t.progress.timer_s == null ? null : formatClock(t.progress.timer_s)) },
  { id: "avgSpeed", label: "Average speed", short: "Avg spd", unit: "km/h", value: (t) => (t.live.avg_speed_mps == null ? null : (t.live.avg_speed_mps * 3.6).toFixed(1)) },
  { id: "avgPower", label: "Average power", short: "Avg pwr", unit: "W", value: (t) => t.live.avg_power_ride_w },
  { id: "powerNp", label: "Normalised power", short: "NP", unit: "W", value: (t) => t.live.power_np_w },
  { id: "avgHr", label: "Average heart rate", short: "Avg HR", unit: "bpm", value: (t) => t.live.avg_hr_ride_bpm },
  { id: "ascent", label: "Altitude gained", short: "Ascent", unit: "m", value: (t) => (t.live.total_ascent_m == null ? null : Math.round(t.live.total_ascent_m)) },

  // Available under Data, off by default.
  { id: "speed", label: "Speed (current)", short: "Speed", unit: "km/h", value: (t) => (t.live.speed_mps == null ? null : (t.live.speed_mps * 3.6).toFixed(1)) },
  { id: "power", label: "Power (30s)", short: "Power", unit: "W", value: (t) => t.live.power_30s_w },
  { id: "hr", label: "Heart rate (current)", short: "HR", unit: "bpm", value: (t) => t.live.hr_bpm },
  { id: "hr5min", label: "Heart rate (5 min)", short: "HR 5m", unit: "bpm", value: (t) => t.live.hr_5min_bpm },
  { id: "cadence", label: "Cadence", short: "Cadence", unit: "rpm", value: (t) => t.live.cad_rpm },
  { id: "altitude", label: "Altitude (current)", short: "Altitude", unit: "m", value: (t) => (t.live.alt_m == null ? null : Math.round(t.live.alt_m)) },
  // Distance over elapsed rather than moving time - the one the record is
  // actually judged on, since stopped time counts against it.
  { id: "avgSpeedElapsed", label: "Avg speed (incl. stops)", short: "Avg elap", unit: "km/h", value: (t) => (t.live.avg_speed_elapsed_mps == null ? null : (t.live.avg_speed_elapsed_mps * 3.6).toFixed(1)) },
  { id: "battery", label: "Edge battery", short: "Battery", unit: "%", value: (t) => t.live.batt_pct },
];

// The eight asked for. Averages and totals rather than instantaneous
// readings, which suits a feed that arrives in 5-minute batches - a
// "current" heart rate here is a number from up to five minutes ago,
// whereas an average is just as true whenever it was measured.
const DEFAULT_FIELDS: TelemetryFieldId[] = [
  "distance",
  "elapsed",
  "moving",
  "avgSpeed",
  "avgPower",
  "powerNp",
  "avgHr",
  "ascent",
];

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
  // Where the ride is in its lifecycle, from api/live-tracker.ts. Drives the
  // LIVE badge - deliberately absent rather than greyed when nothing is
  // arriving, since a permanent badge that only changes colour still reads
  // as "live" at a glance - and whether the readings are captioned as
  // current, last known, or final.
  sessionState: "pending" | "live" | "stalled" | "ended";
  // Changes when the athlete presses start again. Re-fits the map to the
  // route rather than leaving it wherever the last ride finished.
  sessionStartTs: number | null;
  // Identifies which finished ride the summary belongs to, so dismissing
  // one doesn't dismiss the next. Never null once a ride has ended, which
  // matters: keying this on a value that can be null made "not yet
  // dismissed" and "this session" both null, and the overlay concluded it
  // had already been dismissed and never appeared at all.
  sessionEndTs: number | null;
  // Seconds ahead of the target pace at the distance covered - positive
  // ahead, negative behind, null when no target time is configured or
  // there's no route to measure against. Computed on the page rather than
  // here because it needs the route length and target time, which the map
  // has no reason to know about.
  aheadBySeconds: number | null;
  // Titles the end-of-ride summary. Null until the route has loaded, or if
  // it carries no name of its own.
  routeName: string | null;
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
  sessionState,
  sessionStartTs,
  sessionEndTs,
  aheadBySeconds,
  routeName,
}: LiveTrackerMapProps) {
  const { resolvedTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const tileLayerRef = useRef<TileLayer | null>(null);
  // Read inside the map-creation effect, which deliberately runs once - a
  // ref keeps it current there without making the map tear down and rebuild
  // every time the theme changes.
  const themeRef = useRef(resolvedTheme);
  themeRef.current = resolvedTheme;
  const fullLineRef = useRef<Polyline | null>(null);
  const completedLineRef = useRef<Polyline | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const hasFitBoundsRef = useRef(false);
  // Persisted per browser - these reset to defaults on every refresh
  // otherwise, which meant re-picking your fields each time the page
  // reloaded. Full screen and the picker's own open/closed state are
  // deliberately not persisted: reloading straight into a full-screen map,
  // or into an open picker, is not what anyone means by "remember this".
  const [showProfile, setShowProfile] = useStoredState<boolean>("liveMap.showProfile", true, (v) =>
    typeof v === "boolean" ? v : null,
  );
  const [showWeather, setShowWeather] = useStoredState<boolean>("liveMap.showWeather", true, (v) =>
    typeof v === "boolean" ? v : null,
  );
  // Whether the per-field chip row is open, kept separate from whether any
  // fields are on: closing the picker shouldn't switch off the readings
  // you just chose, and the card stays up on its own.
  const [showFieldPicker, setShowFieldPicker] = useState(false);
  // Off by default: switching it on is a choice, whereas a map that
  // silently drags itself back every time you try to look somewhere else
  // is just broken behaviour you didn't ask for.
  const [follow, setFollow] = useStoredState<boolean>("liveMap.follow", false, (v) =>
    typeof v === "boolean" ? v : null,
  );
  // Read inside the position effect, which shouldn't re-run just because
  // the toggle changed - it would replay the marker update for no reason.
  const followRef = useRef(follow);
  followRef.current = follow;
  // Validated against the current field list on the way back in: a saved id
  // that no longer exists would otherwise render a permanently empty row,
  // and there'd be no way to clear it short of emptying site data.
  const [fields, setFields] = useStoredState<TelemetryFieldId[]>("liveMap.fields", DEFAULT_FIELDS, (stored) => {
    if (!Array.isArray(stored)) return null;
    const known = stored.filter((id): id is TelemetryFieldId =>
      TELEMETRY_FIELDS.some((field) => field.id === id),
    );
    // An empty array is a real choice - every field switched off - so it is
    // kept, and only a value that wasn't an array at all falls back.
    return known;
  });
  const [expanded, setExpanded] = useState(false);
  // Dismissed per session, not persisted: a later ride should raise its own
  // summary rather than inherit "I already closed that one".
  const [summaryDismissed, setSummaryDismissed] = useState<number | null>(null);
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
      tileLayerRef.current = L.tileLayer(TILES[themeRef.current], {
        attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
        subdomains: "abcd",
        maxZoom: 19,
      }).addTo(map);
      fullLineRef.current = L.polyline([], { color: ROUTE_COLOR, weight: 4, opacity: 0.6 }).addTo(map);
      completedLineRef.current = L.polyline([], { color: COMPLETED_COLOR, weight: 5, opacity: 0.9 }).addTo(map);
      // divIcon rather than a plain image icon so the logo can be clipped
      // round and given a ring in CSS. Without it a square logo on a busy
      // basemap reads as a piece of page furniture that happens to overlap
      // the map, not as the rider's position.
      //
      // riseOnHover and a high zIndexOffset keep it above the route line
      // where the track doubles back on itself, which this one does.
      markerRef.current = L.marker([0, 0], {
        icon: L.divIcon({
          className: styles.liveMarkerIcon,
          html: `<img src="/logo.png" alt="" class="${styles.liveMarkerImg}" />`,
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        }),
        keyboard: false,
        riseOnHover: true,
        zIndexOffset: 1000,
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
      // panTo, not setView: following should keep whatever zoom the viewer
      // chose. Someone who has zoomed in on a climb wants to stay there and
      // have the map track along, not be yanked back to a fixed level.
      if (followRef.current) {
        mapRef.current?.panTo([position.lat, position.lon]);
      }
    });
  }, [position, route, coveredKm]);

  // Switching follow on shouldn't leave the map wherever it was until the
  // next position arrives - which, at 5-minute batches, could be a long
  // wait for something that looks like a broken button.
  useEffect(() => {
    if (!follow || !position) return;
    mapRef.current?.panTo([position.lat, position.lon]);
  }, [follow, position]);

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

  // Swaps the basemap in place rather than rebuilding the map, so panning,
  // zoom and the drawn route all survive a theme change.
  useEffect(() => {
    tileLayerRef.current?.setUrl(TILES[resolvedTheme]);
  }, [resolvedTheme]);

  // A new session means a new ride: drop the "already fitted" latch so the
  // route effect re-frames the map, rather than leaving it parked wherever
  // the last ride happened to finish - or zoomed into a dot that is now
  // hundreds of kilometres from the start.
  useEffect(() => {
    if (sessionStartTs == null) return;
    hasFitBoundsRef.current = false;
    const map = mapRef.current;
    const line = fullLineRef.current;
    if (map && line) {
      const bounds = line.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [24, 24] });
        hasFitBoundsRef.current = true;
      }
    }
  }, [sessionStartTs]);

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
      {sessionState === "live" && (
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
          className={`${styles.controlButton} ${follow ? styles.controlButtonActive : ""}`}
          onClick={() => setFollow((v) => !v)}
          aria-pressed={follow}
          disabled={!position}
          title={follow ? "Stop centring on the rider" : "Keep the rider centred"}
        >
          Follow
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
        <div className={`${styles.telemetryCard} ${sessionState !== "live" ? styles.telemetryStale : ""}`}>
          {/* Always captioned, not just when something is wrong. These
              numbers arrive in 5-minute batches, so a card that only speaks
              up on failure reads as "current" the rest of the time - when
              what it means is "as of a few minutes ago". "Final" once the
              ride is over: the same numbers mean a different thing then,
              and calling a finished result "last known" implies it might
              still change. */}
          {telemetry.live.age_s != null && (
            <p className={sessionState === "live" ? styles.telemetryAge : styles.telemetryStaleNote}>
              {sessionState === "ended" ? "Final" : sessionState === "stalled" ? "Last known" : formatAge(telemetry.live.age_s)}
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

      {/* Ride over. The same eight readings the card carries, but presented
          as a result rather than a live readout - over the map, because the
          finished route is what it's summarising. Dismissible: someone who
          wants to look at the track shouldn't have to reload to get the
          summary out of the way. */}
      {sessionState === "ended" && telemetry && summaryDismissed !== sessionEndTs && (
        <div className={styles.summaryOverlay}>
          <div className={styles.summaryCard}>
            {/* Both, not one or the other. The route name says which ride
                this summarises, which matters once a screenshot of it is
                shared; the caption says the ride is over, which nothing
                else here does - the telemetry card's "FINAL" is behind
                this overlay. Dropped only when the route has no name, in
                which case the caption becomes the title rather than
                leaving the card untitled. */}
            {routeName && <p className={styles.summaryEyebrow}>Ride complete</p>}
            <p className={styles.summaryTitle}>{routeName ?? "Ride complete"}</p>

            {/* The headline, above the grid rather than in it: on a record
                attempt this is the number that matters, and burying it as
                the ninth cell of eight equals would be an odd way to
                present it. Absent entirely when no target is configured,
                rather than showing a dash - there's nothing to be ahead
                of. */}
            {aheadBySeconds != null && (
              <div className={`${styles.summaryVerdict} ${aheadBySeconds >= 0 ? styles.verdictAhead : styles.verdictBehind}`}>
                <span className={styles.verdictValue}>{formatMargin(aheadBySeconds)}</span>
                <span className={styles.verdictLabel}>{aheadBySeconds >= 0 ? "ahead of target" : "behind target"}</span>
              </div>
            )}

            <div className={styles.summaryGrid}>
              {TELEMETRY_FIELDS.filter((field) => DEFAULT_FIELDS.includes(field.id)).map((field) => {
                const value = field.value(telemetry);
                return (
                  <div key={field.id} className={styles.summaryItem}>
                    <span className={styles.summaryLabel}>{field.label}</span>
                    <span className={styles.summaryValue}>
                      {value ?? "—"}
                      {value != null && field.unit && <span className={styles.summaryUnit}>{field.unit}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
            <button type="button" className={styles.summaryClose} onClick={() => setSummaryDismissed(sessionEndTs)}>
              Show the map
            </button>
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
