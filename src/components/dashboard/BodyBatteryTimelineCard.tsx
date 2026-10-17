import { useEffect, useMemo, useState } from "react";
import { useMeasuredWidth } from "../../utils/useMeasuredWidth";
import { relativeDayLabel } from "../../utils/relativeDate";
import styles from "./BodyBatteryTimelineCard.module.css";

// Garmin's own Body Battery timeline: the battery line over the day's
// 3-minute stress readings, with sleep underneath. Data comes from
// /api/garmin-timeline, which the Garmin sync fills for the last week.

/** [timestamp ms, stress (-1 unmeasured, -2 active) or null, battery or null, 1 if estimated]. */
type Point = [number, number | null, number | null, 0 | 1];

type TimelineDay = {
  date: string;
  dayStart: number;
  dayEnd: number;
  sleep: { start: number; end: number } | null;
  points: Point[];
};

const REST_COLOR = "#4da3ff";
const STRESS_COLOR = "#f97316";
const ACTIVE_COLOR = "rgba(160, 160, 160, 0.35)";
const SLEEP_COLOR = "#2563eb";
const BATTERY_COLOR = "var(--color-text)";

// Garmin's stress bands, labelled on the right edge like its chart.
const BANDS: [number, string][] = [
  [100, "High"],
  [75, "Medium"],
  [50, "Low"],
  [25, "Rest"],
];

const PAD_LEFT = 30;
const PAD_RIGHT = 52;
const PAD_TOP = 8;
const SLEEP_BAR = 6;
const AXIS_HEIGHT = 22;
// A gap longer than this in the battery readings breaks the line rather than
// drawing a confident straight segment across hours of missing data.
const MAX_GAP_MS = 15 * 60 * 1000;
const SAMPLE_MS = 3 * 60 * 1000;

const timeFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Dublin", hour: "2-digit", minute: "2-digit" });

export default function BodyBatteryTimelineCard({ availableHeight }: { availableHeight: number }) {
  const [state, setState] = useState<{ status: "loading" } | { status: "error" } | { status: "ready"; days: TimelineDay[] }>({ status: "loading" });
  const [index, setIndex] = useState<number | null>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const [wrapRef, width] = useMeasuredWidth(480);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/garmin-timeline")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { days?: TimelineDay[] }) => {
        if (!cancelled) setState({ status: "ready", days: body.days ?? [] });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const days = state.status === "ready" ? state.days : [];
  const current = index ?? days.length - 1;
  const day = days[current];

  const summary = useMemo(() => {
    if (!day) return null;
    const latest = day.points.findLast((p) => p[2] != null);
    const stressValues = day.points.map((p) => p[1]).filter((v): v is number => v != null && v >= 0);
    const avgStress = stressValues.length ? Math.round(stressValues.reduce((a, b) => a + b, 0) / stressValues.length) : null;
    return { latest, avgStress };
  }, [day]);

  if (state.status === "loading") return <p className={styles.empty}>Loading timeline…</p>;
  if (state.status === "error") return <p className={styles.empty}>Couldn&apos;t load the timeline right now.</p>;
  if (!day) return <p className={styles.empty}>No timeline yet - it fills in on the next Garmin sync.</p>;

  const plotHeight = Math.max(80, availableHeight - 64 - SLEEP_BAR - AXIS_HEIGHT);
  const plotWidth = Math.max(100, width - PAD_LEFT - PAD_RIGHT);
  const svgHeight = PAD_TOP + plotHeight + 6 + SLEEP_BAR + AXIS_HEIGHT;
  const span = day.dayEnd - day.dayStart;
  const x = (t: number) => PAD_LEFT + ((t - day.dayStart) / span) * plotWidth;
  const y = (v: number) => PAD_TOP + plotHeight - (Math.max(0, Math.min(100, v)) / 100) * plotHeight;
  const barWidth = Math.max(1, (SAMPLE_MS / span) * plotWidth);
  const baseline = PAD_TOP + plotHeight;

  // Battery line, split wherever readings stop or switch between measured and estimated.
  const segments: { estimated: boolean; pts: [number, number][] }[] = [];
  let previous: Point | null = null;
  for (const p of day.points) {
    if (p[2] == null) continue;
    const estimated = p[3] === 1;
    const last = segments.at(-1);
    const continues = last && previous && p[0] - previous[0] <= MAX_GAP_MS;
    if (continues && last.estimated === estimated) {
      last.pts.push([x(p[0]), y(p[2])]);
    } else {
      // Start the new segment from the previous point so the line stays joined.
      const start: [number, number][] = continues && previous ? [[x(previous[0]), y(previous[2]!)]] : [];
      segments.push({ estimated, pts: [...start, [x(p[0]), y(p[2])]] });
    }
    previous = p;
  }
  const toPath = (pts: [number, number][]) => pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join("");

  const sleepStart = day.sleep ? Math.max(day.sleep.start, day.dayStart) : null;
  const sleepEnd = day.sleep ? Math.min(day.sleep.end, day.dayEnd) : null;
  const hours = Math.round(span / 3600000);

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = day.dayStart + ((e.clientX - rect.left - PAD_LEFT) / plotWidth) * span;
    let nearest: Point | null = null;
    for (const p of day.points) if (!nearest || Math.abs(p[0] - t) < Math.abs(nearest[0] - t)) nearest = p;
    setHover(nearest && Math.abs(nearest[0] - t) <= MAX_GAP_MS ? nearest : null);
  };

  const readout = hover
    ? [
        timeFormat.format(hover[0]),
        hover[2] != null ? `Battery ${hover[2]}${hover[3] ? " (est.)" : ""}` : null,
        hover[1] == null || hover[1] === -1 ? "Stress unmeasured" : hover[1] === -2 ? "Active" : `Stress ${hover[1]}`,
      ]
        .filter(Boolean)
        .join(" · ")
    : [
        summary?.latest ? `Battery ${summary.latest[2]} at ${timeFormat.format(summary.latest[0])}` : null,
        summary?.avgStress != null ? `avg stress ${summary.avgStress}` : null,
      ]
        .filter(Boolean)
        .join(" · ");

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <div className={styles.header}>
        <button type="button" className={styles.nav} onClick={() => setIndex(Math.max(0, current - 1))} disabled={current === 0} aria-label="Previous day">
          ‹
        </button>
        <span className={styles.day}>{relativeDayLabel(day.date)}</span>
        <button type="button" className={styles.nav} onClick={() => setIndex(Math.min(days.length - 1, current + 1))} disabled={current === days.length - 1} aria-label="Next day">
          ›
        </button>
        <span className={styles.readout}>{readout}</span>
      </div>

      <svg width={width} height={svgHeight} className={styles.chart} onPointerMove={onPointerMove} onPointerLeave={() => setHover(null)}>
        {BANDS.map(([level, label]) => (
          <g key={level}>
            <line x1={PAD_LEFT} x2={PAD_LEFT + plotWidth} y1={y(level)} y2={y(level)} className={styles.grid} />
            <text x={PAD_LEFT - 6} y={y(level) + 4} textAnchor="end" className={styles.axisLabel}>
              {level}
            </text>
            <text x={PAD_LEFT + plotWidth + 6} y={y(level) + 4} className={styles.axisLabel}>
              {label}
            </text>
          </g>
        ))}
        <line x1={PAD_LEFT} x2={PAD_LEFT + plotWidth} y1={baseline} y2={baseline} className={styles.grid} />

        {sleepStart != null && sleepEnd != null && sleepEnd > sleepStart && (
          <rect x={x(sleepStart)} y={PAD_TOP} width={x(sleepEnd) - x(sleepStart)} height={plotHeight} className={styles.sleepShade} />
        )}

        {day.points.map(([t, stress]) => {
          if (stress == null || stress === -1) return null;
          if (stress === -2) return <rect key={t} x={x(t)} y={PAD_TOP} width={barWidth} height={plotHeight} fill={ACTIVE_COLOR} />;
          return <rect key={t} x={x(t)} y={y(stress)} width={barWidth} height={baseline - y(stress)} fill={stress <= 25 ? REST_COLOR : STRESS_COLOR} />;
        })}

        {segments.map((seg, i) => (
          <g key={i}>
            {!seg.estimated && seg.pts.length > 1 && (
              <path d={`${toPath(seg.pts)}L${seg.pts.at(-1)![0].toFixed(1)},${baseline}L${seg.pts[0][0].toFixed(1)},${baseline}Z`} className={styles.batteryFill} />
            )}
            <path d={toPath(seg.pts)} fill="none" stroke={BATTERY_COLOR} strokeWidth={2} strokeDasharray={seg.estimated ? "3 3" : undefined} />
          </g>
        ))}

        {sleepEnd != null && sleepEnd < day.dayEnd && (
          <line x1={x(sleepEnd)} x2={x(sleepEnd)} y1={PAD_TOP} y2={baseline + 6 + SLEEP_BAR} className={styles.wake} />
        )}
        {sleepStart != null && sleepEnd != null && sleepEnd > sleepStart && (
          <rect x={x(sleepStart)} y={baseline + 6} width={x(sleepEnd) - x(sleepStart)} height={SLEEP_BAR} rx={SLEEP_BAR / 2} fill={SLEEP_COLOR} />
        )}

        {hover && <line x1={x(hover[0])} x2={x(hover[0])} y1={PAD_TOP} y2={baseline} className={styles.cursor} />}

        {Array.from({ length: hours + 1 }, (_, h) => {
          const cx = PAD_LEFT + (h / hours) * plotWidth;
          const major = h % 6 === 0;
          return (
            <g key={h}>
              <circle cx={cx} cy={baseline + 6 + SLEEP_BAR + 8} r={major ? 3 : 1.5} className={styles.tick} />
              {major && (
                <text x={cx} y={baseline + 6 + SLEEP_BAR + AXIS_HEIGHT} textAnchor="middle" className={styles.axisLabel}>
                  {h % 24}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div className={styles.legend}>
        <span><span className={styles.line} />Body Battery</span>
        <span><span className={`${styles.line} ${styles.dashed}`} />Estimated</span>
        <span><span className={styles.dot} style={{ background: REST_COLOR }} />Rest</span>
        <span><span className={styles.dot} style={{ background: STRESS_COLOR }} />Stress</span>
        <span><span className={styles.dot} style={{ background: ACTIVE_COLOR }} />Active</span>
        <span><span className={styles.dot} style={{ background: SLEEP_COLOR }} />Sleep</span>
      </div>
    </div>
  );
}
