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

// Fetches and parses a public GPX file client-side (e.g. a Ride with GPS
// route's public .gpx export URL - no API key needed for a public route).
// Supports both <trk>/<trkpt> (tracks) and <rte>/<rtept> (routes), since
// different tools export one or the other.
export async function fetchGpxRoute(url: string): Promise<RoutePoint[]> {
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
