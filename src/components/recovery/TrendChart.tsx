import styles from "./TrendChart.module.css";

const VIEW_WIDTH = 300;
const VIEW_HEIGHT = 40;

type TrendPoint = { date: string; value: number };

interface TrendChartProps {
  points: TrendPoint[];
}

export default function TrendChart({ points }: TrendChartProps) {
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
      <path d={areaPath} className={styles.area} />
      <path d={linePath} className={styles.line} />
    </svg>
  );
}
