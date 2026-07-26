export type RoutePoint = { lat: number; lon: number; distanceKm: number };

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
export async function fetchRoute(url: string): Promise<RoutePoint[]> {
  return url.includes(".json") ? fetchRideWithGpsJsonRoute(url) : fetchGpxRoute(url);
}

async function fetchRideWithGpsJsonRoute(url: string): Promise<RoutePoint[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Route request failed (${res.status})`);
  const data = (await res.json()) as { track_points?: { x?: number; y?: number; d?: number }[] };
  const trackPoints = data.track_points ?? [];
  return trackPoints
    .filter((p): p is { x: number; y: number; d?: number } => typeof p.x === "number" && typeof p.y === "number")
    .map((p) => ({ lat: p.y, lon: p.x, distanceKm: (p.d ?? 0) / 1000 }));
}

async function fetchGpxRoute(url: string): Promise<RoutePoint[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GPX request failed (${res.status})`);
  const text = await res.text();
  const doc = new DOMParser().parseFromString(text, "application/xml");
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
    points.push({ lat, lon, distanceKm: cumulative });
  }
  return points;
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
