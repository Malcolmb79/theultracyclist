import { useEffect, useState } from "react";
import type { SauceAthleteData } from "../components/race/sauceFeed";
import { eventRouteId, loadCourse, loadRoute, type CourseGeometry, type RouteGeometry } from "../components/race/courseMap";

/**
 * The course and route the watched rider is on: the world's roads once per
 * course, and the route - the event's when racing, otherwise the rider's own.
 */
export function useCourse(address: string, watching: SauceAthleteData | null) {
  const [course, setCourse] = useState<CourseGeometry | null>(null);
  const [route, setRoute] = useState<RouteGeometry | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const s = watching?.state;
  const courseId = s?.courseId;
  const subgroupId = s?.eventSubgroupId;
  const ownRouteId = s?.routeId;

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

  return { course, route, problem };
}

/** How far either side of Sauce's distance to look for the rider on the route. */
const SEARCH_M = 3000;
/** Closer than this to the route line (in world centimetres) and the match is trusted. */
const ON_ROUTE_CM = 6000;

/**
 * Where a rider is on the route's one-lap profile, in metres.
 *
 * Sauce's distance along the route is only a guide: after the first lap it
 * restarts each lap from the short weld between laps rather than the
 * lead-in, and the profile's own length, measured from the road shapes, is
 * never exactly Zwift's. Both put the rider out of step with the profile -
 * on the wrong side of a hill, by the second lap. So the rider's world
 * position is matched to the nearest point on the route, looking near
 * where Sauce's distance says first (roads can be ridden twice in a lap),
 * then anywhere; Sauce's distance is used alone only without a position.
 */
export function routePosition(
  route: RouteGeometry,
  state: { routeDistance?: number; x?: number; y?: number } | null | undefined,
): number | undefined {
  const total = route.distances.at(-1) ?? 0;
  const rd = state?.routeDistance;
  const guess =
    rd == null || !Number.isFinite(rd)
      ? undefined
      : rd <= total || route.lapM <= 0
        ? Math.max(0, rd)
        : route.leadinM + ((rd - route.leadinM) % route.lapM);
  const x = state?.x;
  const y = state?.y;
  if (x == null || y == null || !route.path.length) return guess;

  const nearest = (from: number, to: number) => {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < route.path.length; i++) {
      const d = route.distances[i];
      if (d < from || d > to) continue;
      const dx = route.path[i][0] - x;
      const dy = route.path[i][1] - y;
      const dd = dx * dx + dy * dy;
      if (dd < bestD) {
        bestD = dd;
        best = i;
      }
    }
    return { i: best, cm: Math.sqrt(bestD) };
  };
  let match = guess != null ? nearest(guess - SEARCH_M, guess + SEARCH_M) : { i: -1, cm: Infinity };
  if (match.cm > ON_ROUTE_CM) {
    const anywhere = nearest(-Infinity, Infinity);
    if (anywhere.cm < match.cm) match = anywhere;
  }
  // Far off the route (a different road, a teleport): Sauce's distance is all there is.
  if (match.i < 0 || match.cm > ON_ROUTE_CM * 3) return guess;
  return route.distances[match.i];
}
