import type { ReactNode } from "react";
import styles from "./PageHeader.module.css";

export default function PageHeader({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <div className={styles.header}>
      <h1 className={styles.title}>{title}</h1>
      {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
    </div>
  );
}
