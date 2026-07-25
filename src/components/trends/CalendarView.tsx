import { useState, type CSSProperties } from "react";
import type { TrendMetricDef } from "./useTrendsData";
import { isGoalMet, today } from "./aggregate";
import styles from "./CalendarView.module.css";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface CalendarViewProps {
  metric: TrendMetricDef;
  color: string;
}

function shiftMonth(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default function CalendarView({ metric, color }: CalendarViewProps) {
  const [monthKey, setMonthKey] = useState(() => today().slice(0, 7));
  const [year, month] = monthKey.split("-").map(Number);

  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const cells: (string | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }

  return (
    <div className={styles.calendar}>
      <div className={styles.header}>
        <button type="button" className={styles.navButton} onClick={() => setMonthKey((m) => shiftMonth(m, -1))} aria-label="Previous month">
          ‹
        </button>
        <span className={styles.monthLabel}>
          {MONTH_LABELS[month - 1]} {year}
        </span>
        <button type="button" className={styles.navButton} onClick={() => setMonthKey((m) => shiftMonth(m, 1))} aria-label="Next month">
          ›
        </button>
      </div>
      <div className={styles.weekdays}>
        {WEEKDAY_LABELS.map((w, i) => (
          <span key={i}>{w}</span>
        ))}
      </div>
      <div className={styles.grid}>
        {cells.map((dateStr, i) => {
          if (!dateStr) return <div key={`empty-${i}`} className={styles.cell} />;
          const value = metric.getValue(dateStr);
          const goal = metric.getGoal ? metric.getGoal(dateStr) : null;
          const met = metric.isGoal ? isGoalMet(metric, value, goal) : null;

          let cellStyle: CSSProperties | undefined;
          if (metric.isGoal) {
            if (met === true) cellStyle = { background: "rgba(46, 230, 166, 0.18)", borderColor: "var(--color-accent-2)" };
            else if (met === false) cellStyle = { background: "rgba(255, 176, 32, 0.14)", borderColor: "var(--color-amber)" };
          } else if (value != null) {
            cellStyle = { borderColor: color };
          }

          return (
            <div key={dateStr} className={styles.cell} style={cellStyle} title={value != null ? `${dateStr}: ${value}` : dateStr}>
              <span className={styles.dayNumber}>{Number(dateStr.slice(8, 10))}</span>
              {value != null && (
                <span className={styles.dayValue} style={!metric.isGoal ? { color } : undefined}>
                  {value}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
