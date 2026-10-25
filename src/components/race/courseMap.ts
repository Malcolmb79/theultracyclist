import { sauceRpc } from "./sauceFeed";

// Course geometry for the map overlay, from Sauce's own data: the roads of
// the world being ridden, the route being followed, and which way is north.
// Sauce stores each road as the points it passes through (with Catmull-Rom
// or Bezier smoothing between them); the map smooths them with a plain
// Catmull-Rom spline, which is close enough at overlay size. Rider
// positions (state.x / state.y) are in the same centimetre coordinates.

/** World x, y and (for roads) z, in centimetres. */
export type Point = [number, number, number?];

interface SauceRoad {
  id: number;
  path: number[][];
  looped?: boolean;
}

interface SauceRoute {
  id: number;
  name?: string;
  courseId?: number;
  distanceInMeters?: number;
  manifest?: { roadId: number; start: number; end: number; reverse?: boolean; leadin?: boolean }[];
  /** Segments along one lap: where each starts (metres from the start of the lap) and how long it is. */
  segments?: { id: number; offset: number; distance: number }[];
}

interface SauceSegment {
  id: number;
  name?: string;
}

interface SauceWorldMeta {
  courseId: number;
  name?: string;
  /** Some worlds are stored with their axes swapped; Sauce's map turns them back. */
  flippedHack?: boolean;
  /** Turning road z (cm) into altitude in metres, as Sauce does. */
  seaLevel?: number;
  eleOffset?: number;
  physicsSlopeScale?: number;
}

export interface CourseGeometry {
  courseId: number;
  worldName?: string;
  flipped: boolean;
  roads: Map<number, Point[]>;
  /** Road z to altitude in metres. */
  altitude: (z: number) => number;
}

export type SegmentKind = "sprint" | "climb" | "segment";

export interface RouteSegment {
  /** Zwift's segment id, for its leaderboard. */
  id: number;
  name: string;
  kind: SegmentKind;
  /** Metres along the route, lead-in included. */
  start: number;
  end: number;
}

export interface RouteGeometry {
  id: number;
  name?: string;
  path: Point[];
  /** Metres along the route at each point of path, and the altitude there. */
  distances: number[];
  elevations: number[];
  /** Length of the lead-in before the first lap, and of a lap, in metres. */
  leadinM: number;
  lapM: number;
  segments: RouteSegment[];
}

/** Sprints and climbs by their names, the way Zwift names them. */
function segmentKind(name: string): SegmentKind {
  if (/sprint/i.test(name)) return "sprint";
  if (/kom|qom|climb|summit|hill|col |alpe|mountain|ventoux|epic|reverse kom/i.test(name)) return "climb";
  return "segment";
}

/** Points sampled between each pair of a road's points. */
const SAMPLES = 4;

/** A smooth line through the given points (uniform Catmull-Rom). */
function smooth(points: Point[], looped: boolean): Point[] {
  if (points.length < 3) return points;
  const pts = looped ? [points[points.length - 1], ...points, points[0], points[1]] : points;
  const out: Point[] = [];
  const hasZ = points.every((p) => p[2] != null);
  const at = (i: number) => pts[Math.max(0, Math.min(pts.length - 1, i))];
  const first = looped ? 1 : 0;
  const last = looped ? pts.length - 2 : pts.length - 1;
  for (let i = first; i < last; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    for (let s = 0; s < SAMPLES; s++) {
      const t = s / SAMPLES;
      const t2 = t * t;
      const t3 = t2 * t;
      const c = (k: 0 | 1 | 2) =>
        0.5 *
        (2 * p1[k]! +
          (-p0[k]! + p2[k]!) * t +
          (2 * p0[k]! - 5 * p1[k]! + 4 * p2[k]! - p3[k]!) * t2 +
          (-p0[k]! + 3 * p1[k]! - 3 * p2[k]! + p3[k]!) * t3);
      out.push(hasZ ? [c(0), c(1), c(2)] : [c(0), c(1)]);
    }
  }
  out.push(at(last));
  return out;
}

const courses = new Map<string, Promise<CourseGeometry>>();
const routes = new Map<string, Promise<RouteGeometry | null>>();

export function loadCourse(address: string, courseId: number): Promise<CourseGeometry> {
  const key = `${address}|${courseId}`;
  let p = courses.get(key);
  if (!p) {
    p = (async () => {
      const [worlds, roads] = await Promise.all([
        sauceRpc<SauceWorldMeta[]>(address, "getWorldMetas"),
        sauceRpc<SauceRoad[]>(address, "getCourseRoads", courseId),
      ]);
      const meta = worlds.find((w) => w.courseId === courseId);
      const scale = meta?.physicsSlopeScale || 1;
      return {
        courseId,
        worldName: meta?.name,
        flipped: !!meta?.flippedHack,
        altitude: (z: number) => ((z - (meta?.seaLevel || 0) + (meta?.eleOffset || 0)) / 100) * scale,
        roads: new Map(
          roads
            .filter((r) => Array.isArray(r.path) && r.path.length > 1)
            .map((r) => [r.id, smooth(r.path.map((c) => [c[0], c[1], c[2]] as Point), !!r.looped)]),
        ),
      };
    })();
    // A failed load is retried next time rather than remembered.
    p.catch(() => courses.delete(key));
    courses.set(key, p);
  }
  return p;
}

/**
 * The route as one line: each road section of its manifest, cut to the
 * part of the road it uses (start/end are fractions along the road) and
 * turned round where it's ridden in reverse.
 */
export function loadRoute(address: string, course: CourseGeometry, routeId: number): Promise<RouteGeometry | null> {
  const key = `${address}|${course.courseId}|${routeId}`;
  let p = routes.get(key);
  if (!p) {
    p = (async () => {
      const [route] = await sauceRpc<(SauceRoute | null)[]>(address, "getRoutes", [routeId]);
      if (!route?.manifest) return null;
      const path: Point[] = [];
      let leadinPoints = 0;
      for (const m of route.manifest) {
        const road = course.roads.get(m.roadId);
        if (!road) continue;
        const a = Math.max(0, Math.min(1, Math.min(m.start, m.end)));
        const b = Math.max(0, Math.min(1, Math.max(m.start, m.end)));
        let part = road.slice(Math.floor(a * (road.length - 1)), Math.ceil(b * (road.length - 1)) + 1);
        if (m.reverse) part = part.slice().reverse();
        path.push(...part);
        if (m.leadin) leadinPoints = path.length;
      }
      // Distance along the route and the altitude at each point.
      const distances: number[] = [];
      const elevations: number[] = [];
      let d = 0;
      path.forEach((p, i) => {
        if (i) d += Math.hypot(p[0] - path[i - 1][0], p[1] - path[i - 1][1]) / 100;
        distances.push(d);
        elevations.push(p[2] != null ? course.altitude(p[2]) : 0);
      });
      const leadinM = leadinPoints ? distances[Math.min(leadinPoints, distances.length) - 1] : 0;
      const lapM = Math.max(0, d - leadinM);
      // Segment names come separately; positions are from the start of the lap.
      let segments: RouteSegment[] = [];
      if (route.segments?.length) {
        const named: (SauceSegment | null)[] = await sauceRpc<(SauceSegment | null)[]>(
          address,
          "getSegments",
          route.segments.map((x) => x.id),
        ).catch(() => []);
        const names = new Map(named.filter((x): x is SauceSegment => !!x).map((x) => [x.id, x.name ?? ""]));
        segments = route.segments
          .map((x) => {
            const name = names.get(x.id) || "Segment";
            return { id: x.id, name, kind: segmentKind(name), start: leadinM + x.offset, end: leadinM + x.offset + x.distance };
          })
          .filter((x) => x.start <= d);
      }
      return { id: route.id, name: route.name, path, distances, elevations, leadinM, lapM, segments };
    })();
    p.catch(() => routes.delete(key));
    routes.set(key, p);
  }
  return p;
}

/** Event routes come from the event, not the rider's own route setting. */
export async function eventRouteId(address: string, subgroupId: number): Promise<number | undefined> {
  try {
    const sg = await sauceRpc<{ routeId?: number } | null>(address, "getEventSubgroup", subgroupId);
    return sg?.routeId ?? undefined;
  } catch {
    return undefined;
  }
}

/** World coordinates to north-up screen coordinates (x right, y down). */
export function toScreen(p: Point, flipped: boolean): Point {
  return flipped ? [p[1], -p[0]] : [p[0], p[1]];
}

export function pathData(points: Point[], flipped: boolean): string {
  let d = "";
  for (let i = 0; i < points.length; i++) {
    const [x, y] = toScreen(points[i], flipped);
    d += `${i ? "L" : "M"}${Math.round(x)} ${Math.round(y)}`;
  }
  return d;
}

export function bounds(points: Point[], flipped: boolean) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    const [x, y] = toScreen(p, flipped);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}
