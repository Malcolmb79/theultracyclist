import styles from "./TrendChart.module.css";

const VIEW_WIDTH = 300;
const PLOT_HEIGHT = 40;
const TOP_PAD = 16;
const BOTTOM_PAD = 20;
const DOT_RADIUS = 3;

type TrendPoint = { date: string; value: number };

interface TrendChartProps {
  points: TrendPoint[];
  pointColor?: (point: TrendPoint) => string;
  pointLabel?: (point: TrendPoint) => string;
  showDates?: boolean;
}

function shortDate(iso: string): { weekday: string; day: string } {
  const d = new Date(iso);
  return {
    weekday: d.toLocaleDateString("en-GB", { weekday: "short" }),
    day: d.toLocaleDateString("en-GB", { day: "numeric" }),
  };
}

export default function TrendChart({ points, pointColor, pointLabel, showDates }: TrendChartProps) {
  if (points.length < 2) {
    return null;
  }

  const topPad = pointLabel ? TOP_PAD : 0;
  const bottomPad = showDates ? BOTTOM_PAD : 0;
  const viewHeight = topPad + PLOT_HEIGHT + bottomPad;

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const toX = (i: number) => (i / (points.length - 1)) * VIEW_WIDTH;
  const toY = (value: number) => topPad + PLOT_HEIGHT - ((value - min) / range) * PLOT_HEIGHT;

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(p.value).toFixed(1)}`)
    .join(" ");

  const areaPath =
    `M${toX(0).toFixed(1)},${topPad + PLOT_HEIGHT} ` +
    points.map((p, i) => `L${toX(i).toFixed(1)},${toY(p.value).toFixed(1)}`).join(" ") +
    ` L${toX(points.length - 1).toFixed(1)},${topPad + PLOT_HEIGHT} Z`;

  return (
    <svg
      className={styles.svg}
      viewBox={`0 0 ${VIEW_WIDTH} ${viewHeight}`}
      preserveAspectRatio="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ height: viewHeight }}
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
  );
}
