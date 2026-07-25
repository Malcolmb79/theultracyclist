import { useEffect, useRef, useState } from "react";
import type { TrendMetricDef } from "./useTrendsData";
import type { TrendsWidgetConfig, TrendsViewType } from "./types";
import {
  DEFAULT_TRENDS_COLOR,
  DEFAULT_WIDGET_WIDTH,
  DEFAULT_WIDGET_HEIGHT,
  MIN_WIDGET_WIDTH,
  MIN_WIDGET_HEIGHT,
  DEFAULT_CALENDAR_WIDTH,
  DEFAULT_CALENDAR_HEIGHT,
  MIN_CALENDAR_WIDTH,
  MIN_CALENDAR_HEIGHT,
  WIDGET_GRID_SIZE,
} from "./types";
import { aggregateValue, isGoalMet, today } from "./aggregate";
import CalendarView from "./CalendarView";
import styles from "./TrendsWidget.module.css";

interface TrendsWidgetProps {
  widget: TrendsWidgetConfig;
  metric: TrendMetricDef | undefined;
  days: string[];
  onViewTypeChange: (viewType: TrendsViewType) => void;
  onColorChange: (color: string) => void;
  onResize: (width: number, height: number) => void;
  onResizingChange: (resizing: boolean) => void;
  onRemove: () => void;
}

const VIEW_LABEL: Record<TrendsViewType, string> = {
  day: "Today",
  week: "This week",
  month: "This month",
  calendar: "Calendar",
};

const HEADER_HEIGHT = 40;
const CONTENT_PADDING = 32;

function snapToGrid(value: number): number {
  return Math.round(value / WIDGET_GRID_SIZE) * WIDGET_GRID_SIZE;
}

export default function TrendsWidget({
  widget,
  metric,
  days,
  onViewTypeChange,
  onColorChange,
  onResize,
  onResizingChange,
  onRemove,
}: TrendsWidgetProps) {
  const isCalendar = widget.viewType === "calendar";
  const minWidth = isCalendar ? MIN_CALENDAR_WIDTH : MIN_WIDGET_WIDTH;
  const minHeight = isCalendar ? MIN_CALENDAR_HEIGHT : MIN_WIDGET_HEIGHT;
  const defaultWidth = isCalendar ? DEFAULT_CALENDAR_WIDTH : DEFAULT_WIDGET_WIDTH;
  const defaultHeight = isCalendar ? DEFAULT_CALENDAR_HEIGHT : DEFAULT_WIDGET_HEIGHT;

  const [size, setSize] = useState({
    width: Math.max(minWidth, widget.width ?? defaultWidth),
    height: Math.max(minHeight, widget.height ?? defaultHeight),
  });
  const resizeStart = useRef<{ pointerX: number; pointerY: number; width: number; height: number } | null>(null);
  const liveSize = useRef(size);

  // Switching view type to Calendar mid-session needs more room than a
  // stat widget's default - bump up (and persist) if the current size is
  // below the calendar minimum, matching what a freshly-added calendar
  // widget would get.
  useEffect(() => {
    if (isCalendar && (size.width < MIN_CALENDAR_WIDTH || size.height < MIN_CALENDAR_HEIGHT)) {
      const next = { width: Math.max(size.width, DEFAULT_CALENDAR_WIDTH), height: Math.max(size.height, DEFAULT_CALENDAR_HEIGHT) };
      liveSize.current = next;
      setSize(next);
      onResize(next.width, next.height);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCalendar]);

  const [selected, setSelected] = useState(false);
  const widgetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selected) return;
    const handleOutside = (e: PointerEvent) => {
      if (widgetRef.current && !widgetRef.current.contains(e.target as Node)) {
        setSelected(false);
      }
    };
    document.addEventListener("pointerdown", handleOutside);
    return () => document.removeEventListener("pointerdown", handleOutside);
  }, [selected]);

  const handleResizePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();

    resizeStart.current = { pointerX: e.clientX, pointerY: e.clientY, width: size.width, height: size.height };
    onResizingChange(true);

    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyTouchAction = document.body.style.touchAction;
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";

    const handleMove = (moveEvent: PointerEvent) => {
      if (!resizeStart.current) return;
      moveEvent.preventDefault();
      const dx = moveEvent.clientX - resizeStart.current.pointerX;
      const dy = moveEvent.clientY - resizeStart.current.pointerY;
      const next = {
        width: Math.max(minWidth, snapToGrid(resizeStart.current.width + dx)),
        height: Math.max(minHeight, snapToGrid(resizeStart.current.height + dy)),
      };
      liveSize.current = next;
      setSize(next);
    };

    const finish = () => {
      resizeStart.current = null;
      onResizingChange(false);
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.touchAction = previousBodyTouchAction;
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      onResize(Math.round(liveSize.current.width), Math.round(liveSize.current.height));
    };

    window.addEventListener("pointermove", handleMove, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const color = widget.color ?? DEFAULT_TRENDS_COLOR;
  const contentHeight = Math.max(24, size.height - HEADER_HEIGHT - CONTENT_PADDING);

  return (
    <div
      ref={widgetRef}
      style={{ width: size.width, height: size.height }}
      className={styles.widget}
      data-selected={selected || undefined}
      onPointerDownCapture={() => setSelected(true)}
    >
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
          <CalendarView metric={metric} color={color} height={contentHeight} />
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

      <div
        className={styles.resizeHandle}
        onPointerDown={handleResizePointerDown}
        role="button"
        tabIndex={0}
        aria-label="Drag to resize"
      >
        ⌟
      </div>
    </div>
  );
}
