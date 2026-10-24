import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { useStoredState } from "../utils/useStoredState";
import {
  connectSauce,
  sauceAddressForModPage,
  type FeedStatus,
  type SauceAthleteData,
} from "../components/race/sauceFeed";
import {
  bounds,
  eventRouteId,
  loadCourse,
  loadRoute,
  pathData,
  toScreen,
  type CourseGeometry,
  type Point,
  type RouteGeometry,
} from "../components/race/courseMap";
import styles from "./Map.module.css";

// The course map: Zwift's minimap redone in The Ultra Cyclist's look as a
// Sauce overlay. The route in green over the world's other roads, the line
// the watched rider has ridden in orange, and every rider Sauce can see -
// the watched rider largest, teammates in amber. North is always up. It can
// show the whole route or follow the rider, with a background that fades
// right down so Zwift shows through.

type View = "route" | "follow";
const ZOOMS_KM = [0.5, 1, 2, 5];
/** Enough of the ridden line to see the shape of the last few kilometres. */
const TRAIL_POINTS = 600;
/** Margin round the route in "whole route" view, as a fraction of its size. */
const PAD = 0.06;

function MapOverlay() {
  const address = useMemo(() => sauceAddressForModPage(), []);
  const [status, setStatus] = useState<FeedStatus>("connecting");
  const [watching, setWatching] = useState<SauceAthleteData | null>(null);
  const [nearby, setNearby] = useState<SauceAthleteData[]>([]);
  const [course, setCourse] = useState<CourseGeometry | null>(null);
  const [route, setRoute] = useState<RouteGeometry | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [trail, setTrail] = useState<Point[]>([]);
  const [opacity, setOpacity] = useStoredState("map:opacity", 80, (v) =>
    typeof v === "number" && v >= 0 && v <= 100 ? v : null,
  );
  const [view, setView] = useStoredState<View>("map:view", "route", (v) => (v === "route" || v === "follow" ? v : null));
  const [zoomKm, setZoomKm] = useStoredState("map:zoom", 2, (v) =>
    typeof v === "number" && ZOOMS_KM.includes(v) ? v : null,
  );
  const [otherRoads, setOtherRoads] = useStoredState("map:other-roads", true, (v) =>
    typeof v === "boolean" ? v : null,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const lastPos = useRef<Point | null>(null);

  useEffect(() => {
    document.documentElement.classList.add(styles.transparent);
    return connectSauce(address, { onStatus: setStatus, onWatching: setWatching, onNearby: setNearby });
  }, [address]);

  const s = watching?.state;
  const courseId = s?.courseId;
  const subgroupId = s?.eventSubgroupId;
  const ownRouteId = s?.routeId;

  // The world's roads, once per course.
  useEffect(() => {
    if (courseId == null) return;
    let cancelled = false;
    loadCourse(address, courseId)
      .then((c) => {
        if (cancelled) return;
        setCourse(c);
        setProblem(null);
      })
      .catch((e) => !cancelled && setProblem(`Couldn't load the course from Sauce: ${e instanceof Error ? e.message : e}`));
    return () => {
      cancelled = true;
    };
  }, [address, courseId]);

  // The route: the event's, when racing, otherwise the rider's own.
  useEffect(() => {
    if (!course) return;
    let cancelled = false;
    (async () => {
      const id = (subgroupId ? await eventRouteId(address, subgroupId) : undefined) ?? ownRouteId;
      const r = id != null ? await loadRoute(address, course, id).catch(() => null) : null;
      if (!cancelled) setRoute(r && r.path.length > 1 ? r : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [address, course, subgroupId, ownRouteId]);

  // The ridden line: a point whenever the rider has moved on a bit. A jump
  // (a new world, a teleport) starts it again.
  useEffect(() => {
    if (s?.x == null || s?.y == null) return;
    const p: Point = [s.x, s.y];
    const last = lastPos.current;
    const moved = last ? Math.hypot(p[0] - last[0], p[1] - last[1]) : Infinity;
    if (moved < 500) return;
    lastPos.current = p;
    setTrail((t) => (moved > 100_000 ? [p] : [...t, p].slice(-TRAIL_POINTS)));
  }, [s?.x, s?.y]);

  useEffect(() => {
    setTrail([]);
    lastPos.current = null;
  }, [courseId, watching?.athleteId]);

  const flipped = course?.flipped ?? false;
  const me: Point | null = s?.x != null && s?.y != null ? toScreen([s.x, s.y], flipped) : null;

  // What part of the world to show. Worked out each render: it's a pass
  // over a few thousand points once a second, and follow view needs it fresh.
  const box = (() => {
    if (view === "follow" && me) {
      const half = zoomKm * 100_000 / 2;
      return { x: me[0] - half, y: me[1] - half, w: half * 2, h: half * 2 };
    }
    const b = route ? bounds(route.path, flipped) : trail.length > 1 ? bounds(trail, flipped) : null;
    if (!b) return me ? { x: me[0] - 100_000, y: me[1] - 100_000, w: 200_000, h: 200_000 } : null;
    const size = Math.max(b.maxX - b.minX, b.maxY - b.minY, 50_000);
    const pad = size * PAD;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    return { x: cx - size / 2 - pad, y: cy - size / 2 - pad, w: size + pad * 2, h: size + pad * 2 };
  })();

  const roadPaths = useMemo(
    () => (course ? Array.from(course.roads.values(), (pts) => pathData(pts, course.flipped)) : []),
    [course],
  );
  const routePath = useMemo(() => (route ? pathData(route.path, flipped) : ""), [route, flipped]);
  const trailPath = pathData(trail, flipped);
  const myTeam = watching?.athlete?.team?.trim().toLowerCase();
  const unit = box ? box.w / 100 : 1;

  const toGo =
    watching?.remaining == null
      ? null
      : watching.remainingMetric === "time"
        ? `${Math.max(0, Math.round(watching.remaining / 60))} min to go`
        : `${(Math.max(0, watching.remaining) / 1000).toFixed(1)} km to go`;

  return (
    <div className={styles.map} style={{ ["--map-alpha" as string]: String(opacity / 100) }}>
      <header className={styles.header}>
        <span className={`${styles.dot} ${status === "connected" ? styles.on : styles.off}`} aria-hidden />
        <span className={styles.title}>
          {route?.name ?? course?.worldName ?? (status === "connected" ? "Waiting for Zwift…" : "Connecting to Sauce…")}
        </span>
        <button
          type="button"
          className={styles.gear}
          onClick={() => setSettingsOpen((o) => !o)}
          aria-label="Map settings"
          aria-expanded={settingsOpen}
        >
          ⚙
        </button>
      </header>

      {settingsOpen && (
        <div className={styles.settings}>
          <label className={styles.setting}>
            <span>Background</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
              aria-label="Background opacity"
            />
            <span className={styles.settingValue}>{opacity}%</span>
          </label>
          <label className={styles.setting}>
            <span>View</span>
            <select value={view} onChange={(e) => setView(e.target.value as View)} aria-label="Map view">
              <option value="route">Whole route</option>
              <option value="follow">Follow rider</option>
            </select>
            {view === "follow" && (
              <select value={zoomKm} onChange={(e) => setZoomKm(Number(e.target.value))} aria-label="Map zoom">
                {ZOOMS_KM.map((z) => (
                  <option key={z} value={z}>
                    {z} km
                  </option>
                ))}
              </select>
            )}
          </label>
          <label className={styles.setting}>
            <span>Other roads</span>
            <input type="checkbox" checked={otherRoads} onChange={(e) => setOtherRoads(e.target.checked)} />
          </label>
        </div>
      )}

      <div className={styles.canvas}>
        {box ? (
          <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} preserveAspectRatio="xMidYMid meet" className={styles.svg}>
            {otherRoads &&
              roadPaths.map((d, i) => <path key={i} d={d} className={styles.road} vectorEffect="non-scaling-stroke" />)}
            {routePath && (
              <>
                <path d={routePath} className={styles.routeGlow} vectorEffect="non-scaling-stroke" />
                <path d={routePath} className={styles.route} vectorEffect="non-scaling-stroke" />
              </>
            )}
            {trail.length > 1 && <path d={trailPath} className={styles.trail} vectorEffect="non-scaling-stroke" />}
            {nearby.map((r) => {
              if (r.watching || r.state?.x == null || r.state?.y == null) return null;
              const [x, y] = toScreen([r.state.x, r.state.y], flipped);
              const teammate = !!myTeam && r.athlete?.team?.trim().toLowerCase() === myTeam;
              return (
                <circle
                  key={r.athleteId}
                  cx={x}
                  cy={y}
                  r={unit * (teammate ? 1.4 : 1.1)}
                  className={teammate ? styles.teammate : styles.rider}
                />
              );
            })}
            {me && (
              <>
                <circle cx={me[0]} cy={me[1]} r={unit * 4} className={styles.meHalo} />
                <circle cx={me[0]} cy={me[1]} r={unit * 2} className={styles.me} />
              </>
            )}
          </svg>
        ) : (
          <p className={styles.empty}>{problem ?? "The map appears once Zwift is riding."}</p>
        )}
      </div>

      {(toGo || s?.grade != null) && (
        <footer className={styles.footer}>
          {toGo && <span>{toGo}</span>}
          {s?.grade != null && <span className={styles.grade}>{(s.grade * 100).toFixed(1)}%</span>}
        </footer>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MapOverlay />
  </StrictMode>,
);
