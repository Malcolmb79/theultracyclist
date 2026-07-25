import { useMeasuredWidth } from "../../utils/useMeasuredWidth";
import styles from "./TrendChart.module.css";

const FALLBACK_WIDTH = 300;
const DEFAULT_PLOT_HEIGHT = 40;
const TOP_PAD = 16;
const BOTTOM_PAD = 20;
const DOT_RADIUS = 3;

// Exported so callers can reserve enough height for the plot area *plus*
// this label padding when pointLabel/showDates are used - otherwise the
// chart's total rendered height exceeds whatever box it's given and gets
// clipped by the parent's overflow:hidden.
export const TREND_CHART_LABEL_TOP_PAD = TOP_PAD;
export const TREND_CHART_LABEL_BOTTOM_PAD = BOTTOM_PAD;
// Minimum horizontal space (px) to give each value/date label pair so they
// don't overlap - dense series (many points in limited width) show labels
// only every Nth point instead of cramming one under every single dot.
const MIN_LABEL_SPACING = 42;

type TrendPoint = { date: string; value: number };

interface TrendChartProps {
  points: TrendPoint[];
  pointColor?: (point: TrendPoint) => string;
  pointLabel?: (point: TrendPoint) => string;
  showDates?: boolean;
  height?: number;
  color?: string;
  showArea?: boolean; // default true - set false for a line-only chart with no fill beneath it
}

function shortDate(iso: string): { weekday: string; day: string } {
  const d = new Date(iso);
  return {
    weekday: d.toLocaleDateString("en-GB", { weekday: "short" }),
    day: d.toLocaleDateString("en-GB", { day: "numeric" }),
  };
}

export default function TrendChart({ points, pointColor, pointLabel, showDates, height, color, showArea = true }: TrendChartProps) {
  const [containerRef, viewWidth] = useMeasuredWidth(FALLBACK_WIDTH);

  if (points.length < 2) {
    return <div ref={containerRef} />;
  }

  const plotHeight = height ?? DEFAULT_PLOT_HEIGHT;
  const topPad = pointLabel ? TOP_PAD : 0;
  const bottomPad = showDates ? BOTTOM_PAD : 0;
  const viewHeight = topPad + plotHeight + bottomPad;

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const toX = (i: number) => (i / (points.length - 1)) * viewWidth;
  const toY = (value: number) => topPad + plotHeight - ((value - min) / range) * plotHeight;

  const maxLabels = Math.max(2, Math.floor(viewWidth / MIN_LABEL_SPACING));
  const labelStride = Math.max(1, Math.ceil(points.length / maxLabels));
  const isLabeled = (i: number) => i % labelStride === 0 || i === points.length - 1;

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(p.value).toFixed(1)}`)
    .join(" ");

  const areaPath =
    `M${toX(0).toFixed(1)},${topPad + plotHeight} ` +
    points.map((p, i) => `L${toX(i).toFixed(1)},${toY(p.value).toFixed(1)}`).join(" ") +
    ` L${toX(points.length - 1).toFixed(1)},${topPad + plotHeight} Z`;

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
        {showArea && (
          <path
            d={areaPath}
            className={pointColor && !color ? styles.areaNeutral : styles.area}
            style={color ? { fill: color } : undefined}
          />
        )}
        <path
          d={linePath}
          className={pointColor && !color ? styles.lineNeutral : styles.line}
          style={color ? { stroke: color } : undefined}
        />
        {(pointColor || pointLabel) &&
          points.map((p, i) => (
            <circle
              key={p.date}
              cx={toX(i)}
              cy={toY(p.value)}
              r={DOT_RADIUS}
              fill={pointColor ? pointColor(p) : (color ?? "var(--color-accent-2)")}
              stroke="var(--color-bg-elevated)"
              strokeWidth={1}
            />
          ))}
        {pointLabel &&
          points.map((p, i) =>
            isLabeled(i) ? (
              <text
                key={`label-${p.date}`}
                x={toX(i)}
                y={toY(p.value) - 6}
                textAnchor="middle"
                className={styles.pointLabel}
              >
                {pointLabel(p)}
              </text>
            ) : null,
          )}
        {showDates &&
          points.map((p, i) => {
            if (!isLabeled(i)) return null;
            const { weekday, day } = shortDate(p.date);
            return (
              <text key={`date-${p.date}`} x={toX(i)} y={viewHeight - 8} textAnchor="middle" className={styles.dateLabel}>
                {weekday} {day}
              </text>
            );
          })}
      </svg>
    </div>
  );
}
