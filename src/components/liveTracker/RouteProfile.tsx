import type { RoutePoint } from "../../utils/gpxRoute";
import styles from "./RouteProfile.module.css";

interface RouteProfileProps {
  route: RoutePoint[];
  coveredKm: number;
  totalKm: number;
}

const VIEW_WIDTH = 600;
const VIEW_HEIGHT = 100;
const PAD_X = 2;
const PAD_TOP = 14;
const PAD_BOTTOM = 4;
// Full routes can carry thousands of GPX vertices - way more resolution
// than a ~600px-wide chart needs, so it's downsampled to keep the SVG path
// (and the per-poll marker-position recompute) cheap.
const MAX_SAMPLES = 220;

function sample(points: RoutePoint[], maxPoints: number): RoutePoint[] {
  if (points.length <= maxPoints) return points;
  const step = (points.length - 1) / (maxPoints - 1);
  const out: RoutePoint[] = [];
  for (let i = 0; i < maxPoints; i++) out.push(points[Math.round(i * step)]);
  return out;
}

// Linear interpolation of elevation at a given distance, between the two
// sampled points bracketing it - same approach as api/live-tracker.ts's
// interpolatePosition, just for elevation instead of lat/lon.
function elevationAtKm(points: RoutePoint[], km: number): number | null {
  if (points.length === 0) return null;
  if (km <= points[0].distanceKm) return points[0].elevationM ?? null;
  const last = points[points.length - 1];
  if (km >= last.distanceKm) return last.elevationM ?? null;
  for (let i = 1; i < points.length; i++) {
    if (points[i].distanceKm >= km) {
      const a = points[i - 1];
      const b = points[i];
      if (a.elevationM == null || b.elevationM == null) return null;
      const span = b.distanceKm - a.distanceKm || 1;
      const t = (km - a.distanceKm) / span;
      return a.elevationM + (b.elevationM - a.elevationM) * t;
    }
  }
  return last.elevationM ?? null;
}

// Elevation-vs-distance chart for the full route, with a vertical marker at
// the athlete's current distance covered - "where the dot is" translated
// onto the profile rather than the map. Deliberately plain SVG (no chart
// library), same approach as PerformanceChart.tsx.
export default function RouteProfile({ route, coveredKm, totalKm }: RouteProfileProps) {
  const withElevation = route.filter((p) => p.elevationM != null);
  if (withElevation.length < 2 || totalKm <= 0) {
    return <p className={styles.empty}>No elevation data in this route file.</p>;
  }

  const points = sample(withElevation, MAX_SAMPLES);
  const elevations = points.map((p) => p.elevationM!);
  const minEle = Math.min(...elevations);
  const maxEle = Math.max(...elevations);
  const eleSpan = Math.max(1, maxEle - minEle);

  const x = (km: number) => PAD_X + (Math.min(km, totalKm) / totalKm) * (VIEW_WIDTH - PAD_X * 2);
  const y = (ele: number) =>
    VIEW_HEIGHT - PAD_BOTTOM - ((ele - minEle) / eleSpan) * (VIEW_HEIGHT - PAD_TOP - PAD_BOTTOM);

  const linePoints = points.map((p) => `${x(p.distanceKm)},${y(p.elevationM!)}`).join(" ");
  const areaPoints = `${x(points[0].distanceKm)},${VIEW_HEIGHT} ${linePoints} ${x(points[points.length - 1].distanceKm)},${VIEW_HEIGHT}`;

  const markerKm = Math.min(coveredKm, totalKm);
  const markerX = x(markerKm);
  const markerEle = elevationAtKm(points, markerKm);

  return (
    <div className={styles.wrap}>
      <div className={styles.eleLabels}>
        <span>{Math.round(maxEle)} m</span>
        <span>{Math.round(minEle)} m</span>
      </div>
      <svg viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} preserveAspectRatio="none" className={styles.chart}>
        <polygon points={areaPoints} className={styles.area} />
        <polyline points={linePoints} className={styles.line} />
        <line x1={markerX} y1={0} x2={markerX} y2={VIEW_HEIGHT} className={styles.marker} />
        {markerEle != null && <circle cx={markerX} cy={y(markerEle)} r={3.5} className={styles.markerDot} />}
      </svg>
    </div>
  );
}
