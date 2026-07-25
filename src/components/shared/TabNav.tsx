import type { ReactNode } from "react";
import styles from "./TabNav.module.css";

export interface TabNavItem {
  label: string;
  href: string;
  active?: boolean;
}

export default function TabNav({ items, trailing }: { items: TabNavItem[]; trailing?: ReactNode }) {
  return (
    <nav className={styles.nav}>
      <div className={styles.tabs}>
        {items.map((item) => (
          <a key={item.href} href={item.href} className={`${styles.tab} ${item.active ? styles.tabActive : ""}`}>
            {item.label}
          </a>
        ))}
      </div>
      {trailing && <div className={styles.trailing}>{trailing}</div>}
    </nav>
  );
}
