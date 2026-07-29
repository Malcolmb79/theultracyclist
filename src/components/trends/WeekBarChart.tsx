import { useMeasuredWidth } from "../../utils/useMeasuredWidth";
import { isGoalMet } from "./aggregate";
import type { TrendMetricDef } from "./useTrendsData";
import styles from "./WeekBarChart.module.css";

const FALLBACK_WIDTH = 260;
const DEFAULT_HEIGHT = 120;
const TOP_PAD = 14; // room for the value label above the tallest bar
const BOTTOM_PAD = 14; // room for the weekday label below the baseline
const BAR_GAP = 6;
const MIN_BAR_HEIGHT = 3; // a real 0 still reads as a bar, not a missing day
// Fractions of the week's own value range left below the lowest bar and
// above the tallest, so neither sits flush against an edge.
const BASELINE_PAD = 0.35;
const TOP_HEADROOM = 0.1;

function shortWeekday(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short" });
}

interface WeekBarChartProps {
  metric: TrendMetricDef;
  /** The 7 dates to plot, in display order (see aggregate.ts's datesInRange). */
  dates: string[];
  color: string;
  formatValue: (value: number) => string;
  height?: number;
}

// One bar per day for the week pill, replacing the single aggregated number
// - a week's worth of "did I hit it" is more useful read as 7 bars against
// the goal line than as one blended average, especially for a goal like
// sleep where a single bad night is otherwise invisible.
export default function WeekBarChart({ metric, dates, color, formatValue, height }: WeekBarChartProps) {
  const [containerRef, viewWidth] = useMeasuredWidth(FALLBACK_WIDTH);

  const points = dates.map((date) => ({
    date,
    value: metric.getValue(date),
    goal: metric.getGoal ? metric.getGoal(date) : null,
  }));

  const values = points.map((p) => p.value).filter((v): v is number => v != null);
  const goals = points.map((p) => p.goal).filter((v): v is number => v != null);

  if (values.length === 0 && goals.length === 0) {
    return (
      <div ref={containerRef} style={{ width: "100%" }}>
        <p className={styles.emptyLabel}>No data yet for this metric.</p>
      </div>
    );
  }

  const plotHeight = (height ?? DEFAULT_HEIGHT) - TOP_PAD - BOTTOM_PAD;

  // The scale spans the week's own range rather than always starting at
  // zero. For a metric that never goes near zero - body weight sitting at
  // 72.0/72.4/72.5/72.8kg - a zero baseline puts every bar within 1% of
  // full height, so four different days render as four identical bars and
  // the chart says nothing the labels didn't already. Anchoring to the
  // data makes the bars show the day-to-day difference that's actually
  // being compared.
  //
  // Zero is still the baseline whenever the week genuinely reaches it (a
  // rest day's 0 calories, a night with no sleep logged): it falls out of
  // taking the minimum, no special case needed. Each bar carries its own
  // value label, so the number is never read off the bar height alone.
  const scaleValues = [...values, ...goals];
  const lo = Math.min(...scaleValues);
  const hi = Math.max(...scaleValues);
  const span = hi - lo;
  // BASELINE_PAD keeps the shortest bar a readable stub rather than a
  // sliver, TOP_HEADROOM keeps the tallest one clear of its own label.
  const baseline = span > 0 ? Math.max(0, lo - span * BASELINE_PAD) : Math.max(0, lo - Math.abs(lo || 1) * 0.1);
  const maxScale = span > 0 ? hi + span * TOP_HEADROOM : Math.max(hi * 1.1, 1);
  const scaleRange = maxScale - baseline || 1;

  const n = points.length;
  const colWidth = viewWidth / n;
  const barWidth = Math.max(4, colWidth - BAR_GAP);

  const toBarHeight = (value: number) => Math.max(MIN_BAR_HEIGHT, ((value - baseline) / scaleRange) * plotHeight);
  const toY = (value: number) => TOP_PAD + plotHeight - ((value - baseline) / scaleRange) * plotHeight;

  // A dated goal can change mid-week (see types.ts's DatedGoal), so each
  // day's own goal value is looked up individually rather than assuming a
  // single flat line - but consecutive equal goals still draw as one
  // uninterrupted dashed segment instead of visibly re-starting every day.
  const goalSegments: { x1: number; x2: number; y: number }[] = [];
  points.forEach((p, i) => {
    if (p.goal == null) return;
    const x1 = i * colWidth + colWidth / 2 - barWidth / 2;
    const x2 = x1 + barWidth;
    const y = toY(p.goal);
    const prev = goalSegments[goalSegments.length - 1];
    if (prev && prev.y === y && i > 0 && points[i - 1].goal === p.goal) {
      prev.x2 = x2;
    } else {
      goalSegments.push({ x1, x2, y });
    }
  });

  const viewHeight = height ?? DEFAULT_HEIGHT;

  return (
    <div ref={containerRef} style={{ width: "100%" }}>
      <svg
        width={viewWidth}
        height={viewHeight}
        viewBox={`0 0 ${viewWidth} ${viewHeight}`}
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        style={{ display: "block" }}
      >
        {goalSegments.map((seg, i) => (
          <line key={i} x1={seg.x1} x2={seg.x2} y1={seg.y} y2={seg.y} className={styles.goalLine} />
        ))}
        {points.map((p, i) => {
          const x = i * colWidth + colWidth / 2 - barWidth / 2;
          if (p.value == null) {
            return (
              <rect
                key={p.date}
                x={x}
                y={TOP_PAD + plotHeight - MIN_BAR_HEIGHT}
                width={barWidth}
                height={MIN_BAR_HEIGHT}
                rx={2}
                className={styles.barEmpty}
              />
            );
          }
          const met = metric.isGoal ? isGoalMet(metric, p.value, p.goal) : null;
          const barClass = met === true ? styles.barMet : met === false ? styles.barMissed : styles.bar;
          const barHeight = toBarHeight(p.value);
          return (
            <rect
              key={p.date}
              x={x}
              y={TOP_PAD + plotHeight - barHeight}
              width={barWidth}
              height={barHeight}
              rx={2}
              className={barClass}
              style={met == null ? { fill: color } : undefined}
            />
          );
        })}
        {points.map((p, i) => {
          const x = i * colWidth + colWidth / 2;
          return (
            <text key={`v-${p.date}`} x={x} y={TOP_PAD + plotHeight - toBarHeight(p.value ?? 0) - 4} textAnchor="middle" className={styles.valueLabel}>
              {p.value != null ? formatValue(p.value) : ""}
            </text>
          );
        })}
        {points.map((p, i) => {
          const x = i * colWidth + colWidth / 2;
          return (
            <text key={`d-${p.date}`} x={x} y={viewHeight - 3} textAnchor="middle" className={styles.dayLabel}>
              {shortWeekday(p.date)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
