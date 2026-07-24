import styles from "./TrendChart.module.css";

const VIEW_WIDTH = 300;
const VIEW_HEIGHT = 40;
const DOT_RADIUS = 3;

type TrendPoint = { date: string; value: number };

interface TrendChartProps {
  points: TrendPoint[];
  pointColor?: (point: TrendPoint) => string;
}

export default function TrendChart({ points, pointColor }: TrendChartProps) {
  if (points.length < 2) {
    return null;
  }

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const toX = (i: number) => (i / (points.length - 1)) * VIEW_WIDTH;
  const toY = (value: number) => VIEW_HEIGHT - ((value - min) / range) * VIEW_HEIGHT;

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(p.value).toFixed(1)}`)
    .join(" ");

  const areaPath =
    `M${toX(0).toFixed(1)},${VIEW_HEIGHT} ` +
    points.map((p, i) => `L${toX(i).toFixed(1)},${toY(p.value).toFixed(1)}`).join(" ") +
    ` L${toX(points.length - 1).toFixed(1)},${VIEW_HEIGHT} Z`;

  return (
    <svg
      className={styles.svg}
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      preserveAspectRatio="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d={areaPath} className={pointColor ? styles.areaNeutral : styles.area} />
      <path d={linePath} className={pointColor ? styles.lineNeutral : styles.line} />
      {pointColor &&
        points.map((p, i) => (
          <circle
            key={p.date}
            cx={toX(i)}
            cy={toY(p.value)}
            r={DOT_RADIUS}
            fill={pointColor(p)}
            stroke="var(--color-bg-elevated)"
            strokeWidth={1}
          />
        ))}
    </svg>
  );
}
