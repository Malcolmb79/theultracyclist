import type { ReactNode } from "react";
import styles from "./StatTile.module.css";

interface StatTileProps {
  value: ReactNode;
  label: string;
}

export default function StatTile({ value, label }: StatTileProps) {
  return (
    <div className={styles.tile}>
      <div className={styles.value}>{value}</div>
      <div className={styles.label}>{label}</div>
    </div>
  );
}
