import type { TrendMetricDef } from "./useTrendsData";
import type { TrendsWidgetConfig, TrendsViewType } from "./types";
import { DEFAULT_TRENDS_COLOR } from "./types";
import { aggregateValue, isGoalMet, today } from "./aggregate";
import CalendarView from "./CalendarView";
import styles from "./TrendsWidget.module.css";

interface TrendsWidgetProps {
  widget: TrendsWidgetConfig;
  metric: TrendMetricDef | undefined;
  days: string[];
  onViewTypeChange: (viewType: TrendsViewType) => void;
  onColorChange: (color: string) => void;
  onRemove: () => void;
}

const VIEW_LABEL: Record<TrendsViewType, string> = {
  day: "Today",
  week: "This week",
  month: "This month",
  calendar: "Calendar",
};

export default function TrendsWidget({ widget, metric, days, onViewTypeChange, onColorChange, onRemove }: TrendsWidgetProps) {
  const color = widget.color ?? DEFAULT_TRENDS_COLOR;
  const isCalendar = widget.viewType === "calendar";

  return (
    <div className={`${styles.widget} ${isCalendar ? styles.widgetCalendar : ""}`}>
      <div className={styles.header}>
        <span className={styles.label}>{widget.label}</span>
        <div className={styles.controls}>
          <input
            type="color"
            className={styles.colorInput}
            value={color}
            onChange={(e) => onColorChange(e.target.value)}
            aria-label="Widget color"
          />
          <select
            className={styles.select}
            value={widget.viewType}
            onChange={(e) => onViewTypeChange(e.target.value as TrendsViewType)}
          >
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
            <option value="calendar">Calendar</option>
          </select>
          <button type="button" className={styles.iconButton} onClick={onRemove} aria-label="Remove widget">
            ×
          </button>
        </div>
      </div>

      <div className={styles.content}>
        {!metric ? (
          <p className={styles.empty}>Metric not available.</p>
        ) : isCalendar ? (
          <CalendarView metric={metric} color={color} />
        ) : (
          (() => {
            const anchor = today();
            const value = aggregateValue(metric, days, widget.viewType, anchor);
            const goal = metric.getGoal ? metric.getGoal(anchor) : null;
            const met = metric.isGoal ? isGoalMet(metric, value, goal) : null;
            const valueColor = metric.isGoal
              ? met === true
                ? "var(--color-accent-2)"
                : met === false
                  ? "var(--color-amber)"
                  : color
              : color;

            return (
              <div className={styles.stat}>
                <div className={styles.statValue} style={{ color: valueColor }}>
                  {value != null ? `${value}${metric.unit}` : "—"}
                </div>
                {metric.isGoal && goal != null && (
                  <div className={styles.statGoal}>Goal: {goal}{metric.unit}</div>
                )}
                <div className={styles.statLabel}>{VIEW_LABEL[widget.viewType]}</div>
              </div>
            );
          })()
        )}
      </div>
    </div>
  );
}
