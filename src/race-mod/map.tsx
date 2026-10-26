import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { bounds, pathData, toScreen, type Point } from "../components/race/courseMap";
import { OverlayShell, useSettings, type SettingDef } from "./overlay";
import { useSauce } from "./useSauce";
import { routePosition, useCourse } from "./useCourse";
import ProfileChart from "./ProfileChart";
import styles from "./Map.module.css";

// The course map: Zwift's minimap redone in The Ultra Cyclist's look as a
// Sauce overlay. The route in green over the world's other roads, the line
// the watched rider has ridden in orange, and every rider Sauce can see -
// the watched rider largest, teammates in amber. It can show the whole route
// (north up) or follow the rider - there, optionally turned so the way
// they're riding is up, with the rider set low to show more road ahead, as
// Zwift's own map does - with a background that fades right down so Zwift
// shows through.

const ZOOMS_KM = [0.5, 1, 2, 5];
/** Enough of the ridden line to see the shape of the last few kilometres. */
const TRAIL_POINTS = 600;
/** Margin round the route in "whole route" view, as a fraction of its size. */
const PAD = 0.06;

/** How far back along the ridden line to take the direction of travel from, in trail points (about 5 m each). */
const HEADING_BACK = 6;

const DEFAULTS = { opacity: 80, view: "route", zoom: 2, headingUp: true, riderAt: 0.25, otherRoads: true, riders: true, trail: true, profile: true, title: true, toGo: true };
const DEFS: SettingDef[] = [
  { key: "view", label: "View", type: "select", options: [{ value: "route", label: "Whole route" }, { value: "follow", label: "Follow rider" }] },
  { key: "zoom", label: "Follow zoom", type: "select", options: ZOOMS_KM.map((z) => ({ value: z, label: `${z} km` })) },
  { key: "headingUp", label: "Follow: direction of travel up", type: "toggle" },
  {
    key: "riderAt",
    label: "Follow: rider position",
    type: "select",
    options: [
      { value: 0, label: "Centre" },
      { value: 0.15, label: "A little low" },
      { value: 0.25, label: "Lower third" },
      { value: 0.35, label: "Near the bottom" },
    ],
  },
  { key: "otherRoads", label: "Other roads", type: "toggle" },
  { key: "riders", label: "Riders", type: "toggle" },
  { key: "trail", label: "Ridden line", type: "toggle" },
  { key: "profile", label: "Route profile", type: "toggle" },
  { key: "title", label: "Route name", type: "toggle" },
  { key: "toGo", label: "Distance to go", type: "toggle" },
];

function MapOverlay() {
  const [settings, set] = useSettings("map", DEFAULTS);
  const { address, status, watching, nearby } = useSauce({ nearby: true });
  const { course, route, problem } = useCourse(address, watching);
  const [trail, setTrail] = useState<Point[]>([]);
  const lastPos = useRef<Point | null>(null);
  const s = watching?.state;
  const courseId = s?.courseId;
  const view = settings.view;
  const zoomKm = settings.zoom;

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
      const size = zoomKm * 100_000;
      // The rider set below the middle, leaving more of the map ahead.
      return { x: me[0] - size / 2, y: me[1] - size * (0.5 + settings.riderAt), w: size, h: size };
    }
    const b = route ? bounds(route.path, flipped) : trail.length > 1 ? bounds(trail, flipped) : null;
    if (!b) return me ? { x: me[0] - 100_000, y: me[1] - 100_000, w: 200_000, h: 200_000 } : null;
    const size = Math.max(b.maxX - b.minX, b.maxY - b.minY, 50_000);
    const pad = size * PAD;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    return { x: cx - size / 2 - pad, y: cy - size / 2 - pad, w: size + pad * 2, h: size + pad * 2 };
  })();

  // Following heading up, the world turns about the rider so the way they're
  // going points up the window. Taken from the ridden line, and kept
  // continuous (no jump from 359° to 1°) so the turn eases rather than spins.
  const turn = useRef(0);
  const back = trail.length > HEADING_BACK ? trail[trail.length - 1 - HEADING_BACK] : undefined;
  if (view === "follow" && settings.headingUp && me && back) {
    const from = toScreen(back, flipped);
    if (Math.hypot(me[0] - from[0], me[1] - from[1]) > 1000) {
      const want = -90 - (Math.atan2(me[1] - from[1], me[0] - from[0]) * 180) / Math.PI;
      turn.current += ((((want - turn.current) % 360) + 540) % 360) - 180;
    }
  }
  const rotate = view === "follow" && settings.headingUp && me ? turn.current : 0;

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

  const at = route ? routePosition(route, s) : undefined;

  return (
    <OverlayShell title="Map" settings={settings} setSetting={set} defs={DEFS} className={styles.map}>
      {settings.title && (
        <header className={styles.header}>
          <span className={`${styles.dot} ${status === "connected" ? styles.on : styles.off}`} aria-hidden />
          <span className={styles.title}>
            {route?.name ?? course?.worldName ?? (status === "connected" ? "Waiting for Zwift…" : "Connecting to Sauce…")}
          </span>
        </header>
      )}

      <div className={styles.canvas}>
        {box ? (
          <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} preserveAspectRatio="xMidYMid meet" className={styles.svg}>
            <g
              className={styles.world}
              style={me ? { transform: `rotate(${rotate}deg)`, transformOrigin: `${me[0]}px ${me[1]}px` } : undefined}
            >
              {settings.otherRoads &&
                roadPaths.map((d, i) => <path key={i} d={d} className={styles.road} vectorEffect="non-scaling-stroke" />)}
              {routePath && (
                <>
                  <path d={routePath} className={styles.routeGlow} vectorEffect="non-scaling-stroke" />
                  <path d={routePath} className={styles.route} vectorEffect="non-scaling-stroke" />
                </>
              )}
              {settings.trail && trail.length > 1 && <path d={trailPath} className={styles.trail} vectorEffect="non-scaling-stroke" />}
              {settings.riders &&
                nearby.map((r) => {
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
            </g>
          </svg>
        ) : (
          <p className={styles.empty}>{problem ?? "The map appears once Zwift is riding."}</p>
        )}
      </div>

      {settings.profile && route && (
        <div className={styles.profile}>
          <ProfileChart route={route} at={at} showSegmentNames={false} />
        </div>
      )}

      {((settings.toGo && toGo) || s?.grade != null) && (
        <footer className={styles.footer}>
          {settings.toGo && toGo && <span>{toGo}</span>}
          {s?.grade != null && <span className={styles.grade}>{(s.grade * 100).toFixed(1)}%</span>}
        </footer>
      )}
    </OverlayShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MapOverlay />
  </StrictMode>,
);
