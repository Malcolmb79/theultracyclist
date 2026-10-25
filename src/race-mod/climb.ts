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
/** A rise worth a pop-up: at least this steep on average, this long and this much height. */
const MIN_AVG_PCT = 3;
const MIN_LENGTH_M = 300;
const MIN_GAIN_M = 15;

/** A climb's shape from start to top: its height gain, average and steepest gradient. */
function describe(route: RouteGeometry, start: number, top: number, name?: string): Climb {
  const gain = elevationAt(route, top) - elevationAt(route, start);
  let maxPct = 0;
  for (let d = start; d <= top; d += STEP) maxPct = Math.max(maxPct, gradeAt(route, d, STEP));
  return { name, start, top, gainM: gain, avgPct: (gain / Math.max(1, top - start)) * 100, maxPct };
}

/**
 * The climb at or just ahead of `at` (within `lookAheadM`): a named climb
 * segment if the route has one there, otherwise the rise found by walking
 * the profile - back to where the road started going up, and on to where
 * it stops. Nothing if the road isn't climbing to speak of.
 */
export function findClimb(route: RouteGeometry, at: number, lookAheadM: number): Climb | undefined {
  const end = route.distances.at(-1) ?? 0;
  const named = route.segments.find((s) => s.kind === "climb" && s.end >= at && s.start <= at + lookAheadM);
  if (named) return describe(route, named.start, named.end, named.name);

  // Where the road is climbing: here, or the first steep stretch ahead.
  let probe: number | undefined;
  for (let d = at; d <= Math.min(end, at + lookAheadM); d += STEP) {
    if (gradeAt(route, d) >= MIN_AVG_PCT) {
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
    } else if (high - e > 5 || d - top > 300) break;
  }
  const climb = describe(route, start, top);
  return top - start >= MIN_LENGTH_M && climb.gainM >= MIN_GAIN_M && climb.avgPct >= MIN_AVG_PCT ? climb : undefined;
}

/** The colour for a gradient, from easy green through amber to red - how Zwift shades its climbs. */
export function gradeColor(pct: number): string {
  if (pct < 2) return "#9aa4ae";
  if (pct < 4) return "#2ee6a6";
  if (pct < 7) return "#ffd23f";
  if (pct < 10) return "#ff9a2e";
  return "#ff4d2e";
}
