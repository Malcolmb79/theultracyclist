import styles from "./BmiChart.module.css";

// Standard WHO BMI classification bands, matching a typical clinical BMI
// chart (underweight/healthy/overweight/obese/extremely obese).
const DOMAIN_MIN = 15;
const DOMAIN_MAX = 45;

type Band = { label: string; max: number; color: string };

const BANDS: Band[] = [
  { label: "Underweight", max: 18.5, color: "#f4d35e" },
  { label: "Healthy", max: 25, color: "var(--color-accent-2)" },
  { label: "Overweight", max: 30, color: "var(--color-amber)" },
  { label: "Obese", max: 40, color: "var(--color-accent)" },
  { label: "Extremely obese", max: DOMAIN_MAX, color: "#8b1e1e" },
];

const TICKS = [18.5, 25, 30, 40];

function percentFor(bmi: number): number {
  const clamped = Math.max(DOMAIN_MIN, Math.min(DOMAIN_MAX, bmi));
  return ((clamped - DOMAIN_MIN) / (DOMAIN_MAX - DOMAIN_MIN)) * 100;
}

function categoryFor(bmi: number): Band {
  return BANDS.find((band) => bmi < band.max) ?? BANDS[BANDS.length - 1];
}

const SEGMENTS = (() => {
  let start = DOMAIN_MIN;
  return BANDS.map((band) => {
    const end = Math.min(band.max, DOMAIN_MAX);
    const widthPercent = ((end - start) / (DOMAIN_MAX - DOMAIN_MIN)) * 100;
    start = end;
    return { ...band, widthPercent };
  });
})();

interface BmiChartProps {
  bmi: number | null;
  date: string | null;
}

export default function BmiChart({ bmi, date }: BmiChartProps) {
  if (bmi == null) {
    return (
      <p className={styles.empty}>
        No data yet - needs a weight reading from Apple Health and a height set in Settings.
      </p>
    );
  }

  const category = categoryFor(bmi);
  const markerPercent = percentFor(bmi);

  return (
    <div className={styles.wrap}>
      <div className={styles.headline}>
        <span className={styles.value} style={{ color: category.color }}>
          {bmi.toFixed(1)}
        </span>
        <span className={styles.category} style={{ color: category.color }}>
          {category.label}
        </span>
      </div>

      <div className={styles.barWrap}>
        <div className={styles.marker} style={{ left: `${markerPercent}%` }} title={`BMI ${bmi.toFixed(1)}`} />
        <div className={styles.bar}>
          {SEGMENTS.map((segment) => (
            <div
              key={segment.label}
              className={styles.segment}
              style={{ width: `${segment.widthPercent}%`, background: segment.color }}
            />
          ))}
        </div>
        <div className={styles.ticks}>
          {TICKS.map((tick) => (
            <span key={tick} className={styles.tick} style={{ left: `${percentFor(tick)}%` }}>
              {tick}
            </span>
          ))}
        </div>
      </div>

      {date && <span className={styles.caption}>Last weighed {new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>}
    </div>
  );
}
