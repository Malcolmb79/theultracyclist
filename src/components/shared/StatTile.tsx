import type { ReactNode } from "react";
import styles from "./StatTile.module.css";

interface StatTileProps {
  value: ReactNode;
  label: string;
  subValue?: ReactNode;
  valueColor?: string;
}

export default function StatTile({ value, label, subValue, valueColor }: StatTileProps) {
  return (
    <div className={styles.tile}>
      <div className={styles.value} style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </div>
      {subValue && <div className={styles.subValue}>{subValue}</div>}
      <div className={styles.label}>{label}</div>
    </div>
  );
}
