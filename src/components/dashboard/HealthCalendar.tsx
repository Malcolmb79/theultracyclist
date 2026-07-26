import { useState } from "react";
import { recoveryColor } from "../../utils/recoveryColor";
import { bmiCategoryColor, formatWeight } from "../../utils/bmi";
import HealthDayDetailModal, { type HealthCalendarDay } from "./HealthDayDetailModal";
import styles from "./HealthCalendar.module.css";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const STRAIN_COLOR = "#4B87F5";
const SLEEP_COLOR = "#8FA9C5";
const HRV_COLOR = "#a78bfa";
const WEIGHT_FALLBACK_COLOR = "var(--color-accent-2)";

const HEADER_ROW_HEIGHT = 22;
const WEEKDAY_ROW_HEIGHT = 16;
const LEGEND_ROW_HEIGHT = 20;
const GRID_GAP = 3;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftMonth(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

interface HealthCalendarProps {
  whoopHistory: HealthCalendarDay[];
  weightByDate: Map<string, number>;
  weightUnit: string;
  bmiByDate: Map<string, number>;
  height: number;
}

export default function HealthCalendar({ whoopHistory, weightByDate, weightUnit, bmiByDate, height }: HealthCalendarProps) {
  const [monthKey, setMonthKey] = useState(() => today().slice(0, 7));
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [year, month] = monthKey.split("-").map(Number);

  const byDate = new Map(whoopHistory.map((d) => [d.date.slice(0, 10), d]));

  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const numRows = Math.ceil((firstWeekday + daysInMonth) / 7);

  const cells: (string | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }

  const gridHeight = Math.max(
    numRows * 44,
    height - HEADER_ROW_HEIGHT - WEEKDAY_ROW_HEIGHT - LEGEND_ROW_HEIGHT - GRID_GAP * 3,
  );

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
      <div className={styles.grid} style={{ height: gridHeight, gridTemplateRows: `repeat(${numRows}, 1fr)` }}>
        {cells.map((dateStr, i) => {
          if (!dateStr) return <div key={`empty-${i}`} className={styles.cell} />;

          const day = byDate.get(dateStr);
          const weightVal = weightByDate.get(dateStr);
          const bmi = bmiByDate.get(dateStr);

          // Recovery/HRV/Sleep/Weight get their actual numbers shown
          // directly (colored for at-a-glance reading) since those are the
          // ones worth reading without opening the day detail. Strain stays
          // as a plain color dot - there's only so much a ~50px cell can
          // show before it's unreadable clutter.
          const values: { color: string; text: string; label: string }[] = [];
          if (day?.recovery) {
            values.push({ color: recoveryColor(day.recovery.score), text: `${day.recovery.score}%`, label: `Recovery ${day.recovery.score}%` });
          }
          if (day?.recovery?.hrvMs != null) {
            values.push({ color: HRV_COLOR, text: `${day.recovery.hrvMs}`, label: `HRV ${day.recovery.hrvMs}ms` });
          }
          if (day?.sleep) {
            values.push({ color: SLEEP_COLOR, text: `${day.sleep.performancePercent}%`, label: `Sleep ${day.sleep.performancePercent}%` });
          }
          if (weightVal != null) {
            const weightColor = bmi != null ? bmiCategoryColor(bmi) : WEIGHT_FALLBACK_COLOR;
            const weightText = `${formatWeight(weightVal)}${weightUnit}`;
            values.push({ color: weightColor, text: weightText, label: `Weight ${weightText}` });
          }

          const dots: { color: string; label: string }[] = [];
          if (day?.strain) dots.push({ color: STRAIN_COLOR, label: `Strain ${day.strain.score.toFixed(1)}` });

          const hasData = values.length > 0 || dots.length > 0;
          const title = hasData
            ? [dateStr, ...values.map((v) => v.label), ...dots.map((d) => d.label), "Click for details"].join(" · ")
            : dateStr;

          return (
            <button
              key={dateStr}
              type="button"
              className={styles.cell}
              title={title}
              onClick={() => setOpenDate(dateStr)}
            >
              <span className={styles.dayNumber}>{Number(dateStr.slice(8, 10))}</span>
              {values.length > 0 && (
                <div className={styles.metrics}>
                  {values.map((v, idx) => (
                    <span key={idx} className={styles.metricValue} style={{ color: v.color }}>
                      {v.text}
                    </span>
                  ))}
                </div>
              )}
              {dots.length > 0 && (
                <div className={styles.dots}>
                  {dots.map((d, idx) => (
                    <span key={idx} className={styles.dot} style={{ background: d.color }} />
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>
      <div className={styles.legend}>
        <span><span className={styles.legendDot} style={{ background: "var(--color-amber)" }} />Recovery</span>
        <span><span className={styles.legendDot} style={{ background: STRAIN_COLOR }} />Strain</span>
        <span><span className={styles.legendDot} style={{ background: SLEEP_COLOR }} />Sleep</span>
        <span><span className={styles.legendDot} style={{ background: HRV_COLOR }} />HRV</span>
        <span><span className={styles.legendDot} style={{ background: WEIGHT_FALLBACK_COLOR }} />Weight</span>
      </div>

      {openDate && (
        <HealthDayDetailModal
          date={openDate}
          day={byDate.get(openDate)}
          weightVal={weightByDate.get(openDate) ?? null}
          weightUnit={weightUnit}
          bmi={bmiByDate.get(openDate) ?? null}
          onClose={() => setOpenDate(null)}
        />
      )}
    </div>
  );
}
