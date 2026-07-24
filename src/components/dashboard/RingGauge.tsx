import styles from "./RingGauge.module.css";

const SIZE = 100;
const STROKE = 10;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

interface RingGaugeProps {
  percent: number; // 0-100
  color: string;
  centerValue: string;
  label: string;
  pixelSize?: number;
}

export default function RingGauge({ percent, color, centerValue, label, pixelSize }: RingGaugeProps) {
  const clamped = Math.max(0, Math.min(100, percent));
  const offset = CIRCUMFERENCE * (1 - clamped / 100);

  return (
    <div className={styles.wrap}>
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className={styles.svg}
        style={pixelSize ? { width: pixelSize, height: pixelSize } : undefined}
        aria-hidden="true"
      >
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="var(--color-bg-elevated-2)"
          strokeWidth={STROKE}
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={color}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" className={styles.value}>
          {centerValue}
        </text>
      </svg>
      <span className={styles.label}>{label}</span>
    </div>
  );
}
