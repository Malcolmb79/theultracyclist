import { useRef } from "react";
import type { RouteGeometry } from "../components/race/courseMap";
import { CLIMB_PROBE_PCT, elevationAt, findClimb, gradeColor, type Climb, type ClimbSensitivity } from "./climb";
import shell from "./Overlay.module.css";
import styles from "./ClimbView.module.css";

// The climb pop-up itself - the climb found and held, and its card - shared
// by the Climb pop-up overlay and the Ride stats bar, which can show it
// under the ride numbers the way Zwift's HUD does.

export interface ClimbSettings {
  sensitivity: string;
  ahead: number;
  profile: boolean;
  average: boolean;
  height: boolean;
  progress: boolean;
  steepest: boolean;
}

export const CLIMB_DEFAULTS: ClimbSettings = { sensitivity: "zwift", ahead: 300, profile: true, average: true, height: true, progress: true, steepest: false };

/** How far past the top the pop-up stays, to see the climb out. */
const OVER_TOP_M = 150;
/** Slices of colour along the climb: about one every 100 m, within limits, so steep and gentle parts don't average out. */
const sliceCount = (lengthM: number) => Math.max(16, Math.min(80, Math.round(lengthM / 100)));

function ClimbProfile({ route, climb, at }: { route: RouteGeometry; climb: Climb; at: number }) {
  const len = climb.top - climb.start;
  // Filling the card, as Zwift's does, so a climb looks like one - only a
  // nearly flat one is kept from looking like a wall.
  const SLICES = sliceCount(len);
  const heights = Array.from({ length: SLICES + 1 }, (_, k) => elevationAt(route, climb.start + (len * k) / SLICES));
  const lo = Math.min(...heights);
  const range = Math.max(Math.max(...heights) - lo, 10, len * 0.015);
  const x = (d: number) => ((d - climb.start) / len) * 1000;
  const y = (d: number) => 95 - ((elevationAt(route, d) - lo) / range) * 85;
  // Each slice of the climb filled in the colour of its gradient.
  const slices = Array.from({ length: SLICES }, (_, k) => {
    const a = climb.start + (len * k) / SLICES;
    const b = climb.start + (len * (k + 1)) / SLICES;
    const pct = ((elevationAt(route, b) - elevationAt(route, a)) / (b - a)) * 100;
    return { d: `M${x(a)} 100L${x(a)} ${y(a)}L${x(b)} ${y(b)}L${x(b)} 100Z`, color: gradeColor(pct) };
  });
  const pos = Math.max(climb.start, Math.min(climb.top, at));
  return (
    <div className={styles.profile}>
      <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden>
        {slices.map((s, i) => (
          <path key={i} d={s.d} fill={s.color} fillOpacity={0.85} />
        ))}
        {at >= climb.start && <rect x={0} y={0} height={100} className={styles.ridden} style={{ width: x(pos) }} fill="rgba(var(--hud-bg), 0.45)" />}
      </svg>
      {at >= climb.start && <span className={styles.me} style={{ left: `${(x(pos) / 1000) * 100}%`, top: `${y(pos)}%` }} />}
    </div>
  );
}

/**
 * The climb at or just ahead of the rider. Like Zwift's: once a climb is
 * picked up it's fixed - the same start, top and profile - until the rider
 * is over the top and a little beyond, rather than worked out again every
 * second (which shifted its shape and colours as the rise's edges moved).
 */
export function useClimb(route: RouteGeometry | null, at: number | undefined, settings: ClimbSettings, gradeNow?: number): Climb | null {
  const locked = useRef<Climb | null>(null);
  // Going downhill now - with a little give either way, so a road wavering
  // around flat doesn't flash the pop-up on and off.
  const descending = useRef(false);
  if (gradeNow != null) descending.current = descending.current ? gradeNow < -0.5 : gradeNow < -1.5;

  let climb = locked.current;
  if (climb && at != null && !(at >= climb.start - settings.ahead - 50 && at < climb.top + OVER_TOP_M)) climb = null;
  if (!climb && route && at != null) climb = findClimb(route, at, settings.ahead, settings.sensitivity as ClimbSensitivity) ?? null;
  // Not while the road is going down: a climb ahead waits until the descent
  // is over, and one ridden is put away once over the top and heading down.
  // Partway up a climb, a dip in it doesn't hide it.
  if (climb && at != null && descending.current && (at < climb.start || at >= climb.top)) climb = null;
  locked.current = climb;

  return climb;
}

export function ClimbCard({ route, at, climb, gradeNow, settings }: { route: RouteGeometry; at: number; climb: Climb; gradeNow?: number; settings: ClimbSettings }) {
  const before = at < climb.start;
  const over = at >= climb.top;
  const toTop = Math.max(0, climb.top - Math.max(at, climb.start));
  const heightLeft = Math.max(0, elevationAt(route, climb.top) - elevationAt(route, Math.max(at, climb.start)));
  const done = Math.max(0, Math.min(1, (at - climb.start) / (climb.top - climb.start)));
  return (
        <div className={`${shell.panel} ${styles.panel}`}>
          <div className={styles.head}>
            <span className={styles.name}>{climb.name ?? "Climb"}</span>
            <span className={styles.length}>
              {(climb.top - climb.start) >= 1000 ? `${((climb.top - climb.start) / 1000).toFixed(1)} km` : `${Math.round(climb.top - climb.start)} m`}
            </span>
          </div>
          <div className={styles.body}>
            <span className={styles.grade} style={{ color: gradeNow != null ? gradeColor(gradeNow) : undefined }}>
              {gradeNow != null ? gradeNow.toFixed(1) : "–"}
              <small>%</small>
            </span>
            <span className={styles.facts}>
              {over ? (
                <b>Over the top!</b>
              ) : before ? (
                <b>Starts in {Math.round(climb.start - at)} m</b>
              ) : (
                <b>{toTop >= 1000 ? `${(toTop / 1000).toFixed(2)} km` : `${Math.round(toTop)} m`} to the top</b>
              )}
              {settings.height && !over && <span>{Math.round(heightLeft)} m to climb</span>}
              {settings.average && <span>{climb.avgPct.toFixed(1)}% average</span>}
              {settings.steepest && <span>{climb.maxPct.toFixed(0)}% at its steepest</span>}
            </span>
          </div>
          {settings.profile && <ClimbProfile route={route} climb={climb} at={at} />}
          {settings.progress && (
            <div className={styles.progress} aria-hidden>
              <span style={{ width: `${done * 100}%` }} />
            </div>
          )}
        </div>
  );
}

/**
 * A climb found from the road as it's ridden, for when the route's profile
 * can't give one - the route not known, or the rider not placed on it. Zwift's
 * live gradient says the road is going up: from where it started climbing,
 * the distance and height so far, until it's been flat for a while or heads
 * down. No top to count down to - just what's been climbed.
 */
export interface LiveClimb {
  startDist: number;
  startAlt?: number;
  dist: number;
  alt?: number;
}

/** Flat this far, and a climb picked up from the live gradient is over. */
const LIVE_FLAT_M = 200;
/** It shows once the road has gone up for this far, and this much. */
const LIVE_SHOW_M = 100;
const LIVE_MIN_GAIN_M = 3;

export function useLiveClimb(
  state: { distance?: number; eventDistance?: number; altitude?: number } | null | undefined,
  gradeNow: number | undefined,
  sensitivity: string,
): LiveClimb | null {
  const cand = useRef<{ startDist: number; startAlt?: number; lastUp: number } | null>(null);
  const dist = state?.distance ?? state?.eventDistance;
  if (dist == null || gradeNow == null) return null;
  const probe = CLIMB_PROBE_PCT[sensitivity as ClimbSensitivity] ?? CLIMB_PROBE_PCT.zwift;
  const c = cand.current;
  // A new ride, or a jump back: start again.
  if (c && dist < c.startDist) cand.current = null;
  if (gradeNow >= probe) {
    if (!cand.current) cand.current = { startDist: dist, startAlt: state?.altitude, lastUp: dist };
    else cand.current.lastUp = dist;
  } else if (cand.current && (gradeNow < -1.5 || dist - cand.current.lastUp > LIVE_FLAT_M)) {
    cand.current = null;
  }
  const now = cand.current;
  if (!now || dist - now.startDist < LIVE_SHOW_M) return null;
  // A blip in the gradient isn't a climb: the height has to have gone up too, where it's known.
  if (now.startAlt != null && state?.altitude != null && state.altitude - now.startAlt < LIVE_MIN_GAIN_M) return null;
  return { startDist: now.startDist, startAlt: now.startAlt, dist, alt: state?.altitude };
}

export function LiveClimbCard({ live, gradeNow, settings }: { live: LiveClimb; gradeNow?: number; settings: ClimbSettings }) {
  const len = live.dist - live.startDist;
  const up = live.alt != null && live.startAlt != null ? Math.max(0, live.alt - live.startAlt) : undefined;
  return (
    <div className={`${shell.panel} ${styles.panel}`}>
      <div className={styles.head}>
        <span className={styles.name}>Climb</span>
        <span className={styles.length}>{len >= 1000 ? `${(len / 1000).toFixed(1)} km` : `${Math.round(len)} m`} so far</span>
      </div>
      <div className={styles.body}>
        <span className={styles.grade} style={{ color: gradeNow != null ? gradeColor(gradeNow) : undefined }}>
          {gradeNow != null ? gradeNow.toFixed(1) : "–"}
          <small>%</small>
        </span>
        <span className={styles.facts}>
          <b>Climbing</b>
          {settings.height && up != null && <span>{Math.round(up)} m climbed</span>}
          {settings.average && up != null && len > 0 && <span>{((up / len) * 100).toFixed(1)}% average so far</span>}
        </span>
      </div>
    </div>
  );
}
