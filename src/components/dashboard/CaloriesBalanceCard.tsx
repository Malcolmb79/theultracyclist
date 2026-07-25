import { formatDate } from "../../utils/formatDate";
import styles from "./CaloriesBalanceCard.module.css";

const CONSUMED_COLOR = "var(--color-amber)";
const BURNED_COLOR = "#4B87F5";

function formatKcal(value: number): string {
  return `${Math.round(value).toLocaleString("en-GB")} kcal`;
}

interface CaloriesBalanceCardProps {
  consumed: number | null;
  burned: number | null;
  date: string | null;
}

export default function CaloriesBalanceCard({ consumed, burned, date }: CaloriesBalanceCardProps) {
  if (consumed == null && burned == null) {
    return (
      <p className={styles.empty}>
        No data yet - needs Dietary Energy and/or Active Energy from Apple Health.
      </p>
    );
  }

  const net = consumed != null && burned != null ? Math.round(consumed - burned) : null;
  const max = Math.max(consumed ?? 0, burned ?? 0) || 1;

  return (
    <div className={styles.wrap}>
      <div className={styles.row}>
        <span className={styles.label}>Consumed</span>
        <span className={styles.value} style={{ color: CONSUMED_COLOR }}>
          {consumed != null ? formatKcal(consumed) : "—"}
        </span>
      </div>
      <div className={styles.track}>
        <div className={styles.fill} style={{ width: `${((consumed ?? 0) / max) * 100}%`, background: CONSUMED_COLOR }} />
      </div>

      <div className={styles.row}>
        <span className={styles.label}>Burned</span>
        <span className={styles.value} style={{ color: BURNED_COLOR }}>
          {burned != null ? formatKcal(burned) : "—"}
        </span>
      </div>
      <div className={styles.track}>
        <div className={styles.fill} style={{ width: `${((burned ?? 0) / max) * 100}%`, background: BURNED_COLOR }} />
      </div>

      {net != null && (
        <div className={styles.net}>
          <span className={styles.netLabel}>Net</span>
          <span className={styles.netValue}>
            {net > 0 ? "+" : ""}
            {net.toLocaleString("en-GB")} kcal
          </span>
        </div>
      )}

      {date && <span className={styles.caption}>{formatDate(date)}</span>}
    </div>
  );
}
