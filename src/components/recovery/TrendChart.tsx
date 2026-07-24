import { useEffect, useRef, useState } from "react";
import styles from "./TrendChart.module.css";

const FALLBACK_WIDTH = 300;
const DEFAULT_PLOT_HEIGHT = 40;
const TOP_PAD = 16;
const BOTTOM_PAD = 20;
const DOT_RADIUS = 3;

type TrendPoint = { date: string; value: number };

interface TrendChartProps {
  points: TrendPoint[];
  pointColor?: (point: TrendPoint) => string;
  pointLabel?: (point: TrendPoint) => string;
  showDates?: boolean;
  height?: number;
}

function shortDate(iso: string): { weekday: string; day: string } {
  const d = new Date(iso);
  return {
    weekday: d.toLocaleDateString("en-GB", { weekday: "short" }),
    day: d.toLocaleDateString("en-GB", { day: "numeric" }),
  };
}

// Measures the container's actual rendered width so the SVG's viewBox can
// match it exactly (1:1 scale). Without this, a fixed internal viewBox width
// stretched via CSS to fill a *different* rendered width distorts everything
// inside non-uniformly, including text glyphs — a chart that's resized
// wider or narrower than the fixed reference width visibly "stretches" its
// point/date labels.
function useMeasuredWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    observer.observe(el);
    if (el.clientWidth) setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}

export default function TrendChart({ points, pointColor, pointLabel, showDates, height }: TrendChartProps) {
  const [containerRef, viewWidth] = useMeasuredWidth();

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
        <path d={areaPath} className={pointColor ? styles.areaNeutral : styles.area} />
        <path d={linePath} className={pointColor ? styles.lineNeutral : styles.line} />
        {(pointColor || pointLabel) &&
          points.map((p, i) => (
            <circle
              key={p.date}
              cx={toX(i)}
              cy={toY(p.value)}
              r={DOT_RADIUS}
              fill={pointColor ? pointColor(p) : "var(--color-accent-2)"}
              stroke="var(--color-bg-elevated)"
              strokeWidth={1}
            />
          ))}
        {pointLabel &&
          points.map((p, i) => (
            <text
              key={`label-${p.date}`}
              x={toX(i)}
              y={toY(p.value) - 6}
              textAnchor="middle"
              className={styles.pointLabel}
            >
              {pointLabel(p)}
            </text>
          ))}
        {showDates &&
          points.map((p, i) => {
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
