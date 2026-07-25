import type { ReactNode } from "react";
import styles from "./DashboardStatTile.module.css";

interface DashboardStatTileProps {
  value: ReactNode;
  label: string;
  valueColor?: string;
}

export default function DashboardStatTile({ value, label, valueColor }: DashboardStatTileProps) {
  const accent = valueColor ?? "var(--color-accent-2)";
  return (
    <div className={styles.tile}>
      <span className={styles.badge} style={{ background: accent }} />
      <div className={styles.value} style={{ color: accent }}>
        {value}
      </div>
      <div className={styles.label}>{label}</div>
    </div>
  );
}
