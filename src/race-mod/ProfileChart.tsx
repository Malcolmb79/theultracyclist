import type { RouteGeometry, SegmentKind } from "../components/race/courseMap";
import styles from "./ProfileChart.module.css";

// The route's elevation profile, the way Zwift draws it along the bottom of
// the screen: the climbs and sprints shaded and named, the part already
// ridden dimmed, and the riders as dots on the road. Shapes are an SVG
// stretched to fit; labels and dots are positioned over it in percent, so
// text never stretches with it.

export interface ProfileRider {
  id: number;
  /** Metres along the route (see routePosition). */
  at: number;
  watching?: boolean;
  teammate?: boolean;
}

interface Props {
  route: RouteGeometry;
  /** The watched rider's position, metres along the route. */
  at?: number;
  riders?: ProfileRider[];
  /** Metres to show either side of the rider; the whole route when unset. */
  windowM?: number;
  showSegments?: boolean;
  showSegmentNames?: boolean;
  className?: string;
}

/** Points drawn across the chart - plenty for a smooth line at overlay size. */
const RESOLUTION = 400;

const KIND_CLASS: Record<SegmentKind, string> = {
  sprint: styles.sprint,
  climb: styles.climb,
  segment: styles.segment,
};

export default function ProfileChart({ route, at, riders = [], windowM, showSegments = true, showSegmentNames = true, className }: Props) {
  const { distances, elevations } = route;
  const total = distances.at(-1) ?? 0;
  if (total <= 0) return null;

  // The stretch of road shown.
  let from = 0;
  let to = total;
  if (windowM && at != null) {
    from = Math.max(0, at - windowM * 0.25);
    to = Math.min(total, from + windowM);
    from = Math.max(0, to - windowM);
  }
  const span = to - from;

  // Elevation sampled evenly across that stretch.
  const pts: [number, number][] = [];
  let j = 0;
  for (let k = 0; k <= RESOLUTION; k++) {
    const d = from + (span * k) / RESOLUTION;
    while (j < distances.length - 2 && distances[j + 1] < d) j++;
    const d0 = distances[j];
    const d1 = distances[j + 1] ?? d0;
    const f = d1 > d0 ? (d - d0) / (d1 - d0) : 0;
    pts.push([d, elevations[j] + (elevations[j + 1] - elevations[j] || 0) * Math.max(0, Math.min(1, f))]);
  }
  const lo = Math.min(...pts.map((p) => p[1]));
  const hi = Math.max(...pts.map((p) => p[1]));
  // A flat route still needs some height to draw; keep at least 20 m of range.
  const range = Math.max(hi - lo, 20);
  const x = (d: number) => ((d - from) / span) * 1000;
  const y = (e: number) => 100 - ((e - lo) / range) * 82 - 6;
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join("");
  const area = `${line}L1000 100L0 100Z`;
  const pct = (d: number) => `${((d - from) / span) * 100}%`;
  const visible = (d: number) => d >= from && d <= to;
  const segs = showSegments ? route.segments.filter((s) => s.end >= from && s.start <= to) : [];

  return (
    <div className={`${styles.chart} ${className ?? ""}`}>
      <svg viewBox="0 0 1000 100" preserveAspectRatio="none" className={styles.svg} aria-hidden>
        <defs>
          <linearGradient id="profileFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--color-accent-2)" stopOpacity="0.55" />
            <stop offset="1" stopColor="var(--color-accent-2)" stopOpacity="0.08" />
          </linearGradient>
        </defs>
        {segs.map((s, i) => (
          <rect
            key={i}
            x={x(Math.max(s.start, from))}
            width={Math.max(2, x(Math.min(s.end, to)) - x(Math.max(s.start, from)))}
            y={0}
            height={100}
            className={KIND_CLASS[s.kind]}
          />
        ))}
        <path d={area} fill="url(#profileFill)" />
        <path d={line} className={styles.line} vectorEffect="non-scaling-stroke" />
        {at != null && visible(at) && <rect x={0} width={x(at)} y={0} height={100} className={styles.ridden} />}
      </svg>
      {showSegmentNames &&
        segs.map((s, i) => (
          <span key={i} className={styles.segLabel} style={{ left: pct(Math.max(s.start, from)) }}>
            {s.name}
          </span>
        ))}
      {riders
        .filter((r) => !r.watching && visible(r.at))
        .map((r) => (
          <span key={r.id} className={`${styles.dot} ${r.teammate ? styles.teammate : ""}`} style={{ left: pct(r.at), top: `${y(elevAt(route, r.at))}%` }} />
        ))}
      {at != null && visible(at) && (
        <>
          <span className={styles.marker} style={{ left: pct(at) }} />
          <span className={styles.me} style={{ left: pct(at), top: `${y(elevAt(route, at))}%` }} />
        </>
      )}
    </div>
  );
}

/** Altitude at a distance along the route. */
function elevAt(route: RouteGeometry, d: number): number {
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
