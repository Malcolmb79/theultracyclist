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

/**
 * Where a rider is on the route's one-lap profile, in metres: Sauce's
 * distance along the route, folded back onto the lap after the first.
 */
export function routePosition(route: RouteGeometry, routeDistance: number | undefined): number | undefined {
  if (routeDistance == null || !Number.isFinite(routeDistance)) return undefined;
  const total = route.distances.at(-1) ?? 0;
  if (routeDistance <= total || route.lapM <= 0) return Math.max(0, routeDistance);
  return route.leadinM + ((routeDistance - route.leadinM) % route.lapM);
}
