import { BMI_BANDS, BMI_DOMAIN_MAX, BMI_DOMAIN_MIN, bmiCategory, formatWeight } from "../../utils/bmi";
import { relativeDayLabel } from "../../utils/relativeDate";
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
  // The weight reading this BMI was computed from, already display-unit
  // converted by useDashboardData (so kg or lb depending on the athlete's
  // unit setting) - hence the unit travels with it rather than being
  // assumed here.
  weight: number | null;
  weightUnit: string;
}

export default function BmiChart({ bmi, date, weight, weightUnit }: BmiChartProps) {
  if (bmi == null) {
    return (
      <p className={styles.empty}>
        No data yet - needs a weight reading from Apple Health and a height set in Settings.
      </p>
    );
  }

  const category = bmiCategory(bmi);
  const markerPercent = percentFor(bmi);
  // Kept on the one caption line rather than added as a second row - the
  // widget's floor height (MIN_BMI_HEIGHT in DashboardWidget) is sized for
  // exactly these four rows, and an extra one clips against .content's
  // overflow:hidden at small widget sizes.
  const caption = [
    date ? `Last weighed ${relativeDayLabel(date).toLowerCase()}` : null,
    weight != null ? `${formatWeight(weight)} ${weightUnit}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

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

      {caption && <span className={styles.caption}>{caption}</span>}
    </div>
  );
}
