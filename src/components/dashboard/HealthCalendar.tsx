import { useState } from "react";
import { bmiCategoryColor, formatWeight } from "../../utils/bmi";
import { irelandTodayDateStr } from "../../utils/irelandDate";
import HealthDayDetailModal from "./HealthDayDetailModal";
import { readinessColor, type GarminDay } from "../../utils/garmin";
import styles from "./HealthCalendar.module.css";

const WEEKDAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];
const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const TRAINING_COLOR = "#4B87F5";
const SLEEP_COLOR = "#8FA9C5";
const HRV_COLOR = "#a78bfa";
const WEIGHT_FALLBACK_COLOR = "var(--color-accent-2)";

const HEADER_ROW_HEIGHT = 22;
const WEEKDAY_ROW_HEIGHT = 16;
const LEGEND_ROW_HEIGHT = 20;
const GRID_GAP = 3;

function shiftMonth(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

interface HealthCalendarProps {
  history: GarminDay[];
  weightByDate: Map<string, number>;
  weightUnit: string;
  bmiByDate: Map<string, number>;
  height: number;
}

export default function HealthCalendar({ history, weightByDate, weightUnit, bmiByDate, height }: HealthCalendarProps) {
  const [monthKey, setMonthKey] = useState(() => irelandTodayDateStr().slice(0, 7));
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [year, month] = monthKey.split("-").map(Number);

  const garminByDate = new Map(history.map((d) => [d.date, d]));

  // Monday-first grid, so the leading blanks count from Monday rather than
  // from getUTCDay()'s Sunday - see WEEKDAY_LABELS above.
  const firstWeekday = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
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

          const garminDay = garminByDate.get(dateStr);
          const weightVal = weightByDate.get(dateStr);
          const bmi = bmiByDate.get(dateStr);

          // Readiness/HRV/Sleep/Weight get their actual numbers shown
          // directly (colored for at-a-glance reading) since those are the
          // ones worth reading without opening the day detail. Training stays
          // as a plain color dot - there's only so much a ~50px cell can
          // show before it's unreadable clutter.
          const values: { color: string; text: string; label: string }[] = [];
          if (garminDay?.readiness != null) {
            values.push({ color: readinessColor(garminDay.readiness), text: `${garminDay.readiness}`, label: `Readiness ${garminDay.readiness}` });
          }
          if (garminDay?.hrv != null) {
            values.push({ color: HRV_COLOR, text: `${garminDay.hrv}`, label: `HRV ${garminDay.hrv}ms` });
          }
          if (garminDay?.sleepScore != null) {
            values.push({ color: SLEEP_COLOR, text: `${garminDay.sleepScore}`, label: `Sleep score ${garminDay.sleepScore}` });
          }
          if (weightVal != null) {
            const weightColor = bmi != null ? bmiCategoryColor(bmi) : WEIGHT_FALLBACK_COLOR;
            const weightText = `${formatWeight(weightVal)}${weightUnit}`;
            values.push({ color: weightColor, text: weightText, label: `Weight ${weightText}` });
          }

          const dots: { color: string; label: string }[] = [];
          if (garminDay?.trainingLoad) dots.push({ color: TRAINING_COLOR, label: `Training load ${Math.round(garminDay.trainingLoad)}` });

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
        <span><span className={styles.legendDot} style={{ background: "var(--color-amber)" }} />Readiness</span>
        <span><span className={styles.legendDot} style={{ background: TRAINING_COLOR }} />Training</span>
        <span><span className={styles.legendDot} style={{ background: SLEEP_COLOR }} />Sleep</span>
        <span><span className={styles.legendDot} style={{ background: HRV_COLOR }} />HRV</span>
        <span><span className={styles.legendDot} style={{ background: WEIGHT_FALLBACK_COLOR }} />Weight</span>
      </div>

      {openDate && (
        <HealthDayDetailModal
          date={openDate}
          day={garminByDate.get(openDate)}
          weightVal={weightByDate.get(openDate) ?? null}
          weightUnit={weightUnit}
          bmi={bmiByDate.get(openDate) ?? null}
          onClose={() => setOpenDate(null)}
        />
      )}
    </div>
  );
}
