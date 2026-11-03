import { useEffect, useId, useRef, useState } from "react";
import type { RouteGeometry, SegmentKind } from "../components/race/courseMap";
import type { Arch } from "./arches";
import PowerUpIcon from "./PowerUpIcon";
import { gradeColor } from "./climb";
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
  /** Power-up arches to mark on the road. */
  arches?: Arch[];
  /** What the arches can give, most likely first, when the event says. */
  archPowerUps?: { code: string; share: number }[];
  /** The road filled in the colour of its gradient, slice by slice, as the climb pop-up does. */
  gradeColours?: boolean;
  className?: string;
}

/** At most this many power-ups shown over an arch. */
const ARCH_ICONS = 3;

/** Roughly how wide a segment name is per letter, and the least a cut-short name may have. */
const LABEL_PX_PER_CHAR = 7.4;
const MIN_LABEL_PX = 46;

/** Points drawn across the chart - plenty for a smooth line at overlay size. */
const RESOLUTION = 400;
/** Points per gradient slice - 80 slices across the chart. */
const GRADE_STEP = 5;

const KIND_CLASS: Record<SegmentKind, string> = {
  sprint: styles.sprint,
  climb: styles.climb,
  segment: styles.segment,
};

export default function ProfileChart({
  route,
  at,
  riders = [],
  windowM,
  showSegments = true,
  showSegmentNames = true,
  arches = [],
  archPowerUps = [],
  gradeColours = false,
  className,
}: Props) {
  const clip = `profile-${useId().replace(/:/g, "")}`;
  // The chart's width, so names are only put where they fit.
  const box = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
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
  // Room above the highest point for the power-up arches standing on the road, when they're shown.
  const tall = arches.length ? 60 : 82;
  const y = (e: number) => 100 - ((e - lo) / range) * tall - 6;
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join("");
  const area = `${line}L1000 100L0 100Z`;
  const pct = (d: number) => `${((d - from) / span) * 100}%`;

  // The road in its gradient's colours: slices across the chart, each the
  // colour of its own slope, and a run of slices the same colour drawn as one.
  const gradeBands: { x0: number; x1: number; color: string }[] = [];
  if (gradeColours) {
    for (let k = 0; k < RESOLUTION; k += GRADE_STEP) {
      const a = pts[k];
      const b = pts[Math.min(RESOLUTION, k + GRADE_STEP)];
      const color = gradeColor(b[0] > a[0] ? ((b[1] - a[1]) / (b[0] - a[0])) * 100 : 0);
      const last = gradeBands.at(-1);
      if (last && last.color === color) last.x1 = x(b[0]);
      else gradeBands.push({ x0: x(a[0]), x1: x(b[0]), color });
    }
  }
  const visible = (d: number) => d >= from && d <= to;
  // An arch right at either end is drawn inside the chart rather than half off it.
  const edge = (d: number) => ((d - from) / span < 0.02 ? styles.archStart : (d - from) / span > 0.98 ? styles.archEnd : "");
  const segs = showSegments ? route.segments.filter((s) => s.end >= from && s.start <= to) : [];

  // Names, without the pile-up on a lap race or a route of segments close
  // together: each name once (the one being ridden, else the next one ahead,
  // else the last), the ones ahead of the rider placed first, and a name only
  // where it has room before the next - cut short with "…" if it's tight,
  // left off if there's no room at all (its shading still shows it).
  const labels: { name: string; at: number; room: number }[] = [];
  if (showSegmentNames && segs.length && width > 0) {
    const pxPerM = width / span;
    const here = at ?? from;
    const byName = new Map<string, (typeof segs)[number]>();
    for (const s of segs) {
      const had = byName.get(s.name);
      const better = !had || (had.end < here && s.end >= here) || (s.end >= here && s.start < had.start && had.start > here);
      if (better) byName.set(s.name, s);
    }
    const candidates = Array.from(byName.values())
      .map((s) => ({ name: s.name, at: Math.max(s.start, from) }))
      // Ahead of the rider first, nearest first; then the ones behind.
      .sort((a, b) => (a.at >= here) !== (b.at >= here) ? (a.at >= here ? -1 : 1) : Math.abs(a.at - here) - Math.abs(b.at - here));
    const taken: [number, number][] = [];
    for (const c of candidates) {
      const x = (c.at - from) * pxPerM;
      const want = c.name.length * LABEL_PX_PER_CHAR + 6;
      // Room until the next label already placed to the right, or the chart's edge.
      const next = Math.min(width, ...taken.filter(([a]) => a > x).map(([a]) => a));
      const clash = taken.some(([a, b]) => x < b && x + Math.min(want, next - x) > a);
      const room = Math.min(want, next - x - 4);
      if (clash || room < MIN_LABEL_PX) continue;
      taken.push([x, x + room]);
      labels.push({ ...c, room });
    }
  }

  return (
    <div ref={box} className={`${styles.chart} ${className ?? ""}`}>
      <svg viewBox="0 0 1000 100" preserveAspectRatio="none" className={styles.svg} aria-hidden>
        <defs>
          <linearGradient id="profileFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--color-accent-2)" stopOpacity="0.55" />
            <stop offset="1" stopColor="var(--color-accent-2)" stopOpacity="0.08" />
          </linearGradient>
          {/* Shading stays under the profile, so nothing is drawn but the profile itself. */}
          <clipPath id={clip}>
            <path d={area} />
          </clipPath>
        </defs>
        {!gradeColours && <path d={area} fill="url(#profileFill)" />}
        <g clipPath={`url(#${clip})`}>
          {gradeBands.map((g, i) => (
            <rect key={`g${i}`} x={g.x0} width={g.x1 - g.x0 + 0.5} y={0} height={100} fill={g.color} fillOpacity={0.8} />
          ))}
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
          {at != null && visible(at) && <rect x={0} width={x(at)} y={0} height={100} className={styles.ridden} />}
        </g>
        <path d={line} className={styles.line} vectorEffect="non-scaling-stroke" />
      </svg>
      {showSegmentNames &&
        labels.map((l) => (
          <span key={`${l.name}-${l.at}`} className={styles.segLabel} style={{ left: pct(l.at), maxWidth: `${l.room}px` }}>
            {l.name}
          </span>
        ))}
      {arches.filter((a) => visible(a.at)).map((a) => {
        const icons = archPowerUps.slice(0, ARCH_ICONS);
        const odds = archPowerUps.map((p) => `${p.code.toLowerCase()} ${Math.round(p.share * 100)}%`).join(", ");
        return (
          <span
            key={`${a.kind}-${a.at}`}
            className={`${styles.arch} ${a.at < (at ?? -1) ? styles.archPassed : ""} ${edge(a.at)}`}
            style={{ left: pct(a.at), top: `${y(elevAt(route, a.at))}%` }}
            title={`Power-up arch: ${a.name}${odds ? ` (${odds})` : ""}`}
          >
            {icons.length > 0 && (
              <span className={styles.archIcons}>
                {icons.map((p) => (
                  <PowerUpIcon key={p.code} code={p.code} size={14} />
                ))}
              </span>
            )}
            <svg className={styles.archShape} viewBox="0 0 16 14" aria-hidden>
              <path d="M2 14V7a6 6 0 0 1 12 0v7" />
            </svg>
          </span>
        );
      })}
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
