// A privacy zone for ride maps shown to the public: the stretch of a route
// near where it starts and finishes is cut off, so a run of rides from the
// same front door doesn't pin that door to a few metres. The rest of the
// route is untouched.
//
// Strava applies its own privacy zones to what other people see on Strava,
// but this site reads the athlete's own activities, which come back whole.

const ZONE_METRES = 1000;

function decode(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    for (const axis of [0, 1]) {
      let shift = 0;
      let result = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta;
      else lng += delta;
    }
    points.push([lat, lng]);
  }
  return points;
}

function encodeValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = "";
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  return out + String.fromCharCode(v + 63);
}

function encode(points: [number, number][]): string {
  let lat = 0;
  let lng = 0;
  let out = "";
  for (const [pLat, pLng] of points) {
    out += encodeValue(pLat - lat) + encodeValue(pLng - lng);
    lat = pLat;
    lng = pLng;
  }
  return out;
}

/** Metres between two points given in 1e-5 degrees, as the polyline stores them. */
function metres(a: [number, number], b: [number, number]): number {
  const toRad = Math.PI / 180 / 1e5;
  const dLat = (b[0] - a[0]) * toRad;
  const dLng = (b[1] - a[1]) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toRad) * Math.cos(b[0] * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/**
 * The polyline without the points near its start and its finish. A ride that
 * never leaves the zone (a short loop, or a turbo session with a stray GPS
 * fix) has nothing safe to show, so it comes back empty.
 */
export function trimPolylineEnds(encoded: string, zoneMetres = ZONE_METRES): string {
  if (!encoded) return encoded;
  const points = decode(encoded);
  if (points.length < 2) return "";
  const start = points[0];
  const finish = points[points.length - 1];
  const outside = (p: [number, number]) => metres(p, start) > zoneMetres && metres(p, finish) > zoneMetres;
  const first = points.findIndex(outside);
  if (first === -1) return "";
  let last = points.length - 1;
  while (last > first && !outside(points[last])) last--;
  return encode(points.slice(first, last + 1));
}
