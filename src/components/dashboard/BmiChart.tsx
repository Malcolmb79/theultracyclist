import { BMI_BANDS, BMI_DOMAIN_MAX, BMI_DOMAIN_MIN, bmiCategory } from "../../utils/bmi";
import styles from "./BmiChart.module.css";

const TICKS = [18.5, 25, 30, 40];

function percentFor(bmi: number): number {
  const clamped = Math.max(BMI_DOMAIN_MIN, Math.min(BMI_DOMAIN_MAX, bmi));
  return ((clamped - BMI_DOMAIN_MIN) / (BMI_DOMAIN_MAX - BMI_DOMAIN_MIN)) * 100;
}

const SEGMENTS = (() => {
  let start = BMI_DOMAIN_MIN;
  return BMI_BANDS.map((band) => {
    const end = Math.min(band.max, BMI_DOMAIN_MAX);
    const widthPercent = ((end - start) / (BMI_DOMAIN_MAX - BMI_DOMAIN_MIN)) * 100;
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

  const category = bmiCategory(bmi);
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
