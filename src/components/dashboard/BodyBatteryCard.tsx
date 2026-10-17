import type { BodyBattery, BodyBatteryBand } from "../../utils/bodyBattery";
import styles from "./BodyBatteryCard.module.css";

// Same three colours as the readiness ring, banded on Garmin's Body Battery
// levels (see bodyBattery.ts).
const BAND_COLOR: Record<BodyBatteryBand, string> = {
  high: "var(--color-accent-2)",
  medium: "var(--color-amber)",
  low: "var(--color-accent)",
};

interface BodyBatteryCardProps {
  battery: BodyBattery | null;
  /** Content-area height, so the breakdown can be dropped when cramped. */
  availableHeight: number;
}

// Below this the headline and gauge alone fill the card; the breakdown
// rows would just be clipped by .content's overflow:hidden.
const BREAKDOWN_MIN_HEIGHT = 230;

export default function BodyBatteryCard({ battery, availableHeight }: BodyBatteryCardProps) {
  if (!battery) {
    return <p className={styles.empty}>No Body Battery reading yet today - it appears after the next Garmin sync.</p>;
  }

  const color = BAND_COLOR[battery.band];
  const showBreakdown = availableHeight >= BREAKDOWN_MIN_HEIGHT;

  return (
    <div className={styles.wrap}>
      <div className={styles.hero}>
        <div className={styles.battery} aria-hidden="true">
          <div className={styles.batteryBody}>
            <div className={styles.batteryFill} style={{ width: `${battery.level}%`, background: color }} />
          </div>
          <div className={styles.batteryCap} />
        </div>
        <div className={styles.headline}>
          <span className={styles.level} style={{ color }}>
            {battery.level}
          </span>
          <span className={styles.state} style={{ color }}>
            {battery.headline}
          </span>
        </div>
      </div>

      <div className={styles.outlook}>
        <div className={styles.outlookItem}>
          <span className={styles.outlookValue}>{battery.startLevel}</span>
          <span className={styles.outlookLabel}>Woke</span>
        </div>
        <div className={styles.outlookItem}>
          <span className={styles.outlookValue}>{battery.projectedEndLevel}</span>
          <span className={styles.outlookLabel}>Bedtime, easy day</span>
        </div>
        <div className={styles.outlookItem}>
          <span className={styles.outlookValue}>{battery.spare.rideHours > 0 ? `~${battery.spare.rideHours} h` : "0"}</span>
          <span className={styles.outlookLabel}>Riding in hand</span>
        </div>
      </div>

      {showBreakdown && (
        <ul className={styles.breakdown}>
          {battery.breakdown.map((term) => (
            <li key={term.label} className={styles.term}>
              <span className={styles.termLabel}>{term.label}</span>
              <span className={styles.termDetail}>{term.detail}</span>
              <span className={styles.termPoints} data-negative={term.points < 0 || undefined}>
                {term.points > 0 ? `+${term.points}` : term.points}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
