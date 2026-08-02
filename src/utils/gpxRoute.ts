// elevationM is optional - not every GPX file includes <ele>, though Ride
// with GPS's .json export always does (its "e" field).
export type RoutePoint = { lat: number; lon: number; distanceKm: number; elevationM?: number };

export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

// Fetches and parses a route client-side, from either format:
// - Ride with GPS's public .json route endpoint (https://ridewithgps.com/
//   routes/{id}.json - just append .json to a public route's URL). This is
//   what's actually used in practice: RWGPS's .gpx export requires being
//   logged in even for a public route, but .json doesn't, and it comes with
//   distance already computed by their routing engine (the "d" field, in
//   meters), so no local haversine summation is needed.
// - A plain public GPX file (<trk>/<trkpt> or <rte>/<rtept>), for any other
//   route source.
// The route's own name and description travel with its points, so the page
// can title itself after whatever the athlete called the route rather than
// carrying a hardcoded heading that has to be edited separately every time
// the route changes.
export type Route = {
  points: RoutePoint[];
  name: string | null;
  description: string | null;
};

// Trims, and treats blank as absent - an empty description field should
// leave no subheading behind rather than an empty line the layout still
// makes room for.
function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export async function fetchRoute(url: string): Promise<Route> {
  return url.includes(".json") ? fetchRideWithGpsJsonRoute(url) : fetchGpxRoute(url);
}

type RwgpsRoute = {
  name?: unknown;
  description?: unknown;
  track_points?: { x?: number; y?: number; d?: number; e?: number }[];
};

async function fetchRideWithGpsJsonRoute(url: string): Promise<Route> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Route request failed (${res.status})`);
  const body = (await res.json()) as RwgpsRoute & { route?: RwgpsRoute };
  // Ride with GPS has returned this both flat and wrapped in a "route" key
  // depending on the endpoint, so accept either rather than depending on
  // which one they serve today.
  const data = body.route ?? body;
  const trackPoints = data.track_points ?? [];
  return {
    name: text(data.name),
    description: text(data.description),
    points: trackPoints
      .filter((p): p is { x: number; y: number; d?: number; e?: number } => typeof p.x === "number" && typeof p.y === "number")
      .map((p) => ({ lat: p.y, lon: p.x, distanceKm: (p.d ?? 0) / 1000, elevationM: typeof p.e === "number" ? p.e : undefined })),
  };
}

async function fetchGpxRoute(url: string): Promise<Route> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GPX request failed (${res.status})`);
  const text_ = await res.text();
  const doc = new DOMParser().parseFromString(text_, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Couldn't parse GPX file");

  const points: RoutePoint[] = [];
  let cumulative = 0;
  for (const el of Array.from(doc.querySelectorAll("trkpt, rtept"))) {
    const lat = Number(el.getAttribute("lat"));
    const lon = Number(el.getAttribute("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (points.length > 0) {
      cumulative += haversineKm(points[points.length - 1], { lat, lon });
    }
    const eleText = el.querySelector("ele")?.textContent;
    const elevationM = eleText != null ? Number(eleText) : undefined;
    points.push({ lat, lon, distanceKm: cumulative, elevationM: Number.isFinite(elevationM) ? elevationM : undefined });
  }

  // GPX puts these in <metadata> or on the <trk>/<rte> itself, and exporters
  // disagree about which - so try metadata first, then the track. Scoped
  // queries rather than a bare querySelector("name"), which would happily
  // match the <name> of a waypoint halfway down the file.
  const trackOrRoute = doc.querySelector("trk, rte");
  return {
    points,
    name: text(doc.querySelector("metadata > name")?.textContent ?? trackOrRoute?.querySelector(":scope > name")?.textContent),
    description: text(doc.querySelector("metadata > desc")?.textContent ?? trackOrRoute?.querySelector(":scope > desc")?.textContent),
  };
}

// Snaps a live position to the nearest route vertex and returns the
// route's own cumulative distance at that point - a "nearest vertex" snap
// rather than a true nearest-point-on-segment projection, which is close
// enough given GPX tracks are normally dense (points every ~10-50m).
export function distanceCoveredKm(route: RoutePoint[], position: { lat: number; lon: number }): number {
  if (route.length === 0) return 0;
  let best = route[0];
  let bestDist = haversineKm(route[0], position);
  for (const p of route) {
    const d = haversineKm(p, position);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best.distanceKm;
}

export function totalDistanceKm(route: RoutePoint[]): number {
  return route.length > 0 ? route[route.length - 1].distanceKm : 0;
}

// Initial compass bearing (0-360, clockwise from true north) from a to b -
// used below to find the route's direction of travel, and by the weather
// widget's headwind/tailwind indicator.
export function bearingDegrees(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// The route's own direction of travel at a given distance-covered point,
// looked ahead ~1km so a short straight segment (or GPS jitter between two
// adjacent points) doesn't produce a noisy bearing - used instead of a
// bearing between the last two live position fixes, since MapShare pings
// are infrequent and the route itself is far denser.
export function courseBearingAtKm(route: RoutePoint[], km: number, lookAheadKm = 1): number | null {
  if (route.length < 2) return null;
  let startIdx = route.findIndex((p) => p.distanceKm >= km);
  if (startIdx === -1) startIdx = route.length - 1;
  if (startIdx === 0) startIdx = 1;
  const start = route[startIdx - 1];
  let endIdx = startIdx;
  while (endIdx < route.length - 1 && route[endIdx].distanceKm - start.distanceKm < lookAheadKm) endIdx++;
  const end = route[endIdx];
  if (start.lat === end.lat && start.lon === end.lon) return null;
  return bearingDegrees(start, end);
}
