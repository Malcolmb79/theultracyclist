import type { ReactNode } from "react";
import styles from "./StatTile.module.css";

interface StatTileProps {
  value: ReactNode;
  label: string;
  subValue?: ReactNode;
}

export default function StatTile({ value, label, subValue }: StatTileProps) {
  return (
    <div className={styles.tile}>
      <div className={styles.value}>{value}</div>
      {subValue && <div className={styles.subValue}>{subValue}</div>}
      <div className={styles.label}>{label}</div>
    </div>
  );
}
