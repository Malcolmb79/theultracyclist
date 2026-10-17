import type { Readiness } from "./types";
import styles from "./ReadinessCard.module.css";

const LEVEL_COLOR: Record<Readiness["level"], string> = {
  hard: "var(--color-accent-2)",
  moderate: "var(--color-amber)",
  easy: "var(--color-amber)",
  rest: "var(--color-accent)",
};

export default function ReadinessCard({ readiness }: { readiness: Readiness }) {
  return (
    <div className={styles.card}>
      <span className={styles.eyebrow}>Today's readiness</span>
      <span className={styles.headline} style={{ color: LEVEL_COLOR[readiness.level] }}>
        {readiness.headline}
      </span>
      <p className={styles.reason} style={{ color: LEVEL_COLOR[readiness.level] }}>
        {readiness.reason}
      </p>
      <div className={styles.stats}>
        {readiness.readiness != null && (
          <div className={styles.stat}>
            <span className={styles.statValue}>{readiness.readiness}</span>
            <span className={styles.statLabel}>Readiness</span>
          </div>
        )}
        {readiness.sleepScore != null && (
          <div className={styles.stat}>
            <span className={styles.statValue}>{readiness.sleepScore}</span>
            <span className={styles.statLabel}>Sleep score</span>
          </div>
        )}
        {readiness.recoveryHours != null && (
          <div className={styles.stat}>
            <span className={styles.statValue}>{Math.round(readiness.recoveryHours)}h</span>
            <span className={styles.statLabel}>Recovery time</span>
          </div>
        )}
      </div>
    </div>
  );
}
