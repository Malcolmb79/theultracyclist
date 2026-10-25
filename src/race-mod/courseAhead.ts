import type { RouteGeometry } from "../components/race/courseMap";
import type { CourseAhead } from "../components/race/raceLog";
import { elevationAt } from "./climb";

// The road ahead of the rider, from the route, for the tactics coach to plan
// around the way a team leader in the car would: where the next climb or
// sprint is, how long and steep it is, and what the next few kilometres do.
// Distances here are along the route as Sauce counts them (lead-in, then
// lap after lap); the route geometry covers the lead-in and one lap.

/** How far ahead to look for segments. */
const HORIZON_M = 15_000;
const STEP_M = 50;
const STEEP_WINDOW_M = 200;

export function courseAhead(route: RouteGeometry, routeDistance: number, remainingM?: number): CourseAhead {
  const total = route.distances.at(-1) ?? 0;
  // Absolute route metres to a place on the route geometry.
  const wrap = (r: number) => (r <= total || route.lapM <= 0 ? r : route.leadinM + ((r - route.leadinM) % route.lapM));
  const elev = (r: number) => elevationAt(route, wrap(r));
  const pct = (a: number, b: number) => (b > a ? ((elev(b) - elev(a)) / (b - a)) * 100 : 0);
  const finish = remainingM != null && remainingM > 0 ? routeDistance + remainingM : undefined;
  const horizon = Math.min(routeDistance + HORIZON_M, finish ?? Infinity);

  // Each segment wherever it falls: once in the lead-in, every lap after.
  const laps = route.lapM > 0 ? Math.ceil((horizon - route.leadinM) / route.lapM) + 1 : 1;
  const occurrences = route.segments.flatMap((s) => {
    if (s.start < route.leadinM || route.lapM <= 0) return [{ ...s }];
    return Array.from({ length: laps }, (_, n) => ({ ...s, start: s.start + n * route.lapM, end: s.end + n * route.lapM }));
  });
  const relevant = occurrences.filter((s) => s.end > routeDistance && s.start < horizon).sort((a, b) => a.start - b.start);

  const inside = relevant.find((s) => s.start <= routeDistance);
  const next = relevant
    .filter((s) => s.start > routeDistance)
    .slice(0, 3)
    .map((s) => ({
      name: s.name,
      kind: s.kind,
      inKm: Math.round((s.start - routeDistance) / 100) / 10,
      lengthKm: Math.round((s.end - s.start) / 100) / 10,
      avgPct: Math.round(pct(s.start, s.end) * 10) / 10,
    }));

  let climbM = 0;
  let descentM = 0;
  let steepestPct = 0;
  const end = Math.min(routeDistance + 5000, finish ?? Infinity);
  for (let r = routeDistance; r + STEP_M <= end; r += STEP_M) {
    const rise = elev(r + STEP_M) - elev(r);
    if (rise > 0) climbM += rise;
    else descentM -= rise;
    if (r + STEEP_WINDOW_M <= end) steepestPct = Math.max(steepestPct, pct(r, r + STEEP_WINDOW_M));
  }

  return {
    current: inside && {
      name: inside.name,
      kind: inside.kind,
      toGoM: Math.round(inside.end - routeDistance),
      avgPct: Math.round(pct(inside.start, inside.end) * 10) / 10,
    },
    next,
    next5km: { climbM: Math.round(climbM), descentM: Math.round(descentM), steepestPct: Math.round(steepestPct * 10) / 10 },
    finishInKm: finish != null && finish - routeDistance <= HORIZON_M ? Math.round((finish - routeDistance) / 100) / 10 : undefined,
  };
}
