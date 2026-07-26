import type { Readiness } from "./types";
import styles from "./ReadinessCard.module.css";

const LEVEL_COLOR: Record<Readiness["level"], string> = {
  hard: "var(--color-accent-2)",
  moderate: "var(--color-amber)",
  easy: "var(--color-amber)",
  rest: "var(--color-accent)",
};

interface ReadinessCardProps {
  readiness: Readiness;
  // False when the latest recovery reading isn't actually today's -
  // recovery/sleep are a once-daily morning reading (see DATA_SEMANTICS in
  // api/_lib/coachContext.ts), so before Whoop posts today's, `readiness`
  // is still built from yesterday's number. Showing that as if it were
  // today's would be misleading, so this shows a waiting placeholder
  // instead rather than silently presenting stale data as current.
  isFresh: boolean;
}

export default function ReadinessCard({ readiness, isFresh }: ReadinessCardProps) {
  if (!isFresh) {
    return (
      <div className={styles.card}>
        <span className={styles.eyebrow}>Today's readiness</span>
        <span className={styles.headline} style={{ color: "var(--color-text-muted)" }}>
          Waiting for today's reading
        </span>
        <p className={styles.reason} style={{ color: "var(--color-text-muted)" }}>
          Whoop generates recovery once, first thing after you wake from last night's sleep - today's hasn't landed
          yet. Check back shortly.
        </p>
        {readiness.recentAvgStrain != null && (
          <div className={styles.stats}>
            <div className={styles.stat}>
              <span className={styles.statValue}>{readiness.recentAvgStrain}</span>
              <span className={styles.statLabel}>Avg strain, 3d</span>
            </div>
          </div>
        )}
      </div>
    );
  }

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
