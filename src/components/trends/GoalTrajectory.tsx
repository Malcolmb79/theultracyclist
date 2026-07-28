import { useEffect, useRef, useState } from "react";
import styles from "./GoalTrajectory.module.css";

export interface TrajectoryPoint {
  date: string;
  value: number;
}

/**
 * A goal plotted from where it started to the day it is due.
 *
 * The figures alone say how far there is to go; they don't say whether the
 * rate gets there. This draws the actual readings against the straight line
 * from the starting value to the target on the target date — the pace that
 * arrives exactly on time. Above or below that line is the whole answer, and
 * it is a shape rather than a number.
 *
 * The x axis runs to the target date rather than to the last reading, because
 * the remaining time is the part being judged. A chart that stops today shows
 * progress without showing whether it is enough.
 */

const HEIGHT = 170;
const PAD_TOP = 12;
const PAD_BOTTOM = 22;
const PAD_LEFT = 44;

function toDay(iso: string): number {
  return Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
}

function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
}

export default function GoalTrajectory({
  points,
  target,
  targetDate,
  todayIso,
  unit,
  direction,
}: {
  points: TrajectoryPoint[];
  target: number;
  targetDate: string;
  todayIso: string;
  unit: string;
  /** Which way counts as progress, so "ahead" means the right side of the line. */
  direction: "down" | "up";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(420);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width;
      if (measured) setWidth(measured);
    });
    observer.observe(element);
    if (element.clientWidth) setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  const ordered = [...points].sort((a, b) => a.date.localeCompare(b.date));
  if (ordered.length === 0) return null;

  const startDay = toDay(ordered[0].date);
  const endDay = toDay(targetDate);
  // A target date already passed would give a zero or negative span and
  // divide the whole chart by nothing.
  const span = Math.max(endDay - startDay, 86_400_000);

  const values = [...ordered.map((p) => p.value), target];
  const low = Math.min(...values);
  const high = Math.max(...values);
  const padding = (high - low || Math.abs(high) || 1) * 0.15;
  const min = low - padding;
  const max = high + padding;

  const plotWidth = Math.max(60, width - PAD_LEFT);
  const xFor = (ms: number) => PAD_LEFT + Math.min(1, Math.max(0, (ms - startDay) / span)) * plotWidth;
  const yFor = (value: number) => PAD_TOP + (1 - (value - min) / (max - min)) * (HEIGHT - PAD_TOP - PAD_BOTTOM);

  const actual = ordered.map((p) => `${xFor(toDay(p.date)).toFixed(1)},${yFor(p.value).toFixed(1)}`);
  const paceStart = { x: xFor(startDay), y: yFor(ordered[0].value) };
  const paceEnd = { x: xFor(endDay), y: yFor(target) };

  // Where the pace line sits today, against where the reading actually is.
  const todayMs = toDay(todayIso);
  const progressed = Math.min(1, Math.max(0, (todayMs - startDay) / span));
  const paceToday = ordered[0].value + (target - ordered[0].value) * progressed;
  const latest = ordered[ordered.length - 1].value;
  const ahead = direction === "down" ? latest <= paceToday : latest >= paceToday;
  const lineColour = ahead ? "var(--color-good, #2ee6a6)" : "var(--color-warn, #e0a13a)";

  return (
    <div className={styles.wrap} ref={ref}>
      <svg width={width} height={HEIGHT} role="img" aria-label="Progress against the pace needed to reach the goal">
        {/* The target itself, so the gap to it is readable at any point. */}
        <line x1={PAD_LEFT} x2={width} y1={yFor(target)} y2={yFor(target)} stroke="var(--color-border)" strokeWidth={1} />
        <text x={4} y={yFor(target) + 4} fontSize="10" fill="var(--color-text-muted)">
          {Math.round(target * 10) / 10}
        </text>
        <text x={4} y={yFor(ordered[0].value) + 4} fontSize="10" fill="var(--color-text-muted)">
          {Math.round(ordered[0].value * 10) / 10}
        </text>

        {/* The pace that arrives exactly on the day. Dashed, because it is a
            plan rather than something that happened. */}
        <line
          x1={paceStart.x}
          y1={paceStart.y}
          x2={paceEnd.x}
          y2={paceEnd.y}
          stroke="var(--color-text-muted)"
          strokeWidth={1.5}
          strokeDasharray="5 4"
        />

        {todayMs > startDay && todayMs < endDay && (
          <line x1={xFor(todayMs)} x2={xFor(todayMs)} y1={PAD_TOP} y2={HEIGHT - PAD_BOTTOM} stroke="var(--color-border)" strokeWidth={1} />
        )}

        <polyline points={actual.join(" ")} fill="none" stroke={lineColour} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {ordered.length <= 30 &&
          ordered.map((p) => (
            <circle key={p.date} cx={xFor(toDay(p.date))} cy={yFor(p.value)} r={2.5} fill="var(--color-bg)" stroke={lineColour} strokeWidth={1.5}>
              <title>{`${p.date}: ${Math.round(p.value * 10) / 10}${unit}`}</title>
            </circle>
          ))}

        {/* Where it has to end up, and when. */}
        <circle cx={paceEnd.x} cy={paceEnd.y} r={4} fill="var(--color-bg)" stroke="var(--color-text-muted)" strokeWidth={1.5} />

        <text x={PAD_LEFT} y={HEIGHT - 6} fontSize="10" fill="var(--color-text-muted)">
          {shortDate(startDay)}
        </text>
        <text x={width} y={HEIGHT - 6} fontSize="10" textAnchor="end" fill="var(--color-text-muted)">
          {shortDate(endDay)}
        </text>
      </svg>

      <p className={styles.verdict} style={{ color: lineColour }}>
        {ahead ? "Ahead of pace" : "Behind pace"}
        <span className={styles.detail}>
          {" · "}
          {Math.abs(Math.round((latest - paceToday) * 10) / 10)}
          {unit} {ahead ? "better than" : "off"} where the plan has you today
        </span>
      </p>
    </div>
  );
}
