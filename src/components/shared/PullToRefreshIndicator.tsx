import styles from "./PullToRefreshIndicator.module.css";

interface PullToRefreshIndicatorProps {
  pullDistance: number;
  refreshing: boolean;
  triggerDistance: number;
}

// Rests just off the top edge of the viewport and slides down into view as
// pullDistance grows from 0 (hidden) to triggerDistance (fully revealed,
// capped there rather than tracking the finger further past it) - purely
// visual, usePullToRefresh owns the actual gesture tracking and refresh call.
export default function PullToRefreshIndicator({ pullDistance, refreshing, triggerDistance }: PullToRefreshIndicatorProps) {
  if (pullDistance === 0 && !refreshing) return null;

  const progress = Math.min(1, pullDistance / triggerDistance);
  const translateY = refreshing ? 0 : (progress - 1) * 60;
  const pastTrigger = pullDistance >= triggerDistance;

  return (
    <div className={styles.wrap} style={{ transform: `translate(-50%, ${translateY}px)` }}>
      <div className={`${styles.spinner} ${refreshing || pastTrigger ? styles.active : ""}`} />
    </div>
  );
}
