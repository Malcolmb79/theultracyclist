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
        {readiness.recoveryScore != null && (
          <div className={styles.stat}>
            <span className={styles.statValue}>{readiness.recoveryScore}%</span>
            <span className={styles.statLabel}>Recovery</span>
          </div>
        )}
        {readiness.recentAvgStrain != null && (
          <div className={styles.stat}>
            <span className={styles.statValue}>{readiness.recentAvgStrain}</span>
            <span className={styles.statLabel}>Avg strain, 3d</span>
          </div>
        )}
      </div>
    </div>
  );
}
