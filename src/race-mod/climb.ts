import type { RouteGeometry } from "../components/race/courseMap";

// Finding the climb the rider is on, or coming up to, from the route's
// elevation - a named KOM where the route has one, otherwise any sustained
// rise - with what's left of it.

export interface Climb {
  name?: string;
  /** Metres along the route. */
  start: number;
  top: number;
  gainM: number;
  avgPct: number;
  maxPct: number;
}

/** Elevation at a distance along the route, interpolated. */
export function elevationAt(route: RouteGeometry, d: number): number {
  const { distances, elevations } = route;
  let lo = 0;
  let hi = distances.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (distances[mid] < d) lo = mid;
    else hi = mid;
  }
  const f = distances[hi] > distances[lo] ? (d - distances[lo]) / (distances[hi] - distances[lo]) : 0;
  return elevations[lo] + (elevations[hi] - elevations[lo]) * Math.max(0, Math.min(1, f));
}

/** Gradient (%) over the stretch either side of a point. */
function gradeAt(route: RouteGeometry, d: number, span = 50): number {
  return ((elevationAt(route, d + span) - elevationAt(route, d - span)) / (2 * span)) * 100;
}

const STEP = 25;

/**
 * What counts as a climb worth a pop-up: how steep the road has to get to
 * notice it (probePct), and how steep on average, how long and how much
 * height the whole rise needs. "zwift" is as eager as Zwift's own climb
 * view, which comes up for short drags as well as real climbs.
 */
export type ClimbSensitivity = "zwift" | "standard" | "big";
/**
 * When a rise counts as a climb, and how long a flat stretch or how big a
 * dip it carries on through before its top - Zwift's own runs on over
 * plateaus and small dips to the real top of the hill.
 */
const THRESHOLDS: Record<ClimbSensitivity, { probePct: number; avgPct: number; lengthM: number; gainM: number; plateauM: number; dipM: number }> = {
  zwift: { probePct: 2.5, avgPct: 2, lengthM: 150, gainM: 6, plateauM: 600, dipM: 8 },
  standard: { probePct: 3, avgPct: 3, lengthM: 300, gainM: 15, plateauM: 300, dipM: 5 },
  big: { probePct: 4, avgPct: 4, lengthM: 800, gainM: 40, plateauM: 300, dipM: 5 },
};

/** A climb's shape from start to top: its height gain, average and steepest gradient. */
function describe(route: RouteGeometry, start: number, top: number, name?: string): Climb {
  const gain = elevationAt(route, top) - elevationAt(route, start);
  let maxPct = 0;
  for (let d = start; d <= top; d += STEP) maxPct = Math.max(maxPct, gradeAt(route, d, STEP));
  return { name, start, top, gainM: gain, avgPct: (gain / Math.max(1, top - start)) * 100, maxPct };
}

/**
 * Whether a stretch of the route really climbs, ridden this way round - by
 * the same standard as any rise: enough height gain and average gradient.
 * A KOM segment ridden in reverse, or net downhill here, doesn't.
 */
export function climbsHere(route: RouteGeometry, seg: { start: number; end: number }, sensitivity: ClimbSensitivity = "zwift"): boolean {
  const t = THRESHOLDS[sensitivity];
  const c = describe(route, seg.start, seg.end);
  return c.gainM >= t.gainM && c.avgPct >= t.avgPct;
}

/**
 * The climb at or just ahead of `at` (within `lookAheadM`): a named climb
 * segment if the route has one there, otherwise the rise found by walking
 * the profile - back to where the road started going up, and on to where
 * it stops. Nothing if the road isn't climbing to speak of.
 */
export function findClimb(
  route: RouteGeometry,
  at: number,
  lookAheadM: number,
  sensitivity: ClimbSensitivity = "zwift",
): Climb | undefined {
  const t = THRESHOLDS[sensitivity];
  const end = route.distances.at(-1) ?? 0;
  // A named climb, if it really climbs this way round: a KOM segment can be
  // ridden in reverse, or be net downhill where the route crosses it.
  const named = route.segments.find((s) => s.kind === "climb" && s.end >= at && s.start <= at + lookAheadM && climbsHere(route, s, sensitivity));
  if (named) return describe(route, named.start, named.end, named.name);

  // Where the road is climbing: here, or the first steep stretch ahead.
  let probe: number | undefined;
  for (let d = at; d <= Math.min(end, at + lookAheadM); d += STEP) {
    if (gradeAt(route, d) >= t.probePct) {
      probe = d;
      break;
    }
  }
  if (probe == null) return undefined;

  // Back to the foot: until the road has been flat or downhill for a while.
  let start = probe;
  for (let d = probe, flat = 0; d > 0 && flat < 150; d -= STEP) {
    flat = gradeAt(route, d, STEP) < 1 ? flat + STEP : 0;
    if (flat === 0) start = d;
  }
  // On to the top: the highest point before the road drops away for good.
  let top = probe;
  let high = elevationAt(route, probe);
  for (let d = probe; d < end; d += STEP) {
    const e = elevationAt(route, d);
    if (e > high) {
      high = e;
      top = d;
    } else if (high - e > t.dipM || d - top > t.plateauM) break;
  }
  const climb = describe(route, start, top);
  return top - start >= t.lengthM && climb.gainM >= t.gainM && climb.avgPct >= t.avgPct ? climb : undefined;
}

/** The colour for a gradient, as Zwift shades its climbs: grey flat, blue gentle, then yellow, orange and red as it steepens. */
export function gradeColor(pct: number): string {
  if (pct < 1) return "#9aa4ae";
  if (pct < 4) return "#3aa7dc";
  if (pct < 7) return "#f5c518";
  if (pct < 10) return "#ff8a3d";
  return "#e8412c";
}
