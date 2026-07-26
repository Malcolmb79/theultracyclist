import { useEffect, useRef, useState } from "react";
import { useCanvasItem } from "../../utils/useCanvasItem";
import type { TrendMetricDef } from "./useTrendsData";
import type { TrendsWidgetConfig, TrendsViewType } from "./types";
import HealthCalendar from "../dashboard/HealthCalendar";
import type { HealthCalendarDay } from "../dashboard/HealthDayDetailModal";
import { isWeightMetricId, formatWeight } from "../../utils/bmi";
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
  MOBILE_DEFAULT_WIDGET_WIDTH,
  MOBILE_DEFAULT_WIDGET_HEIGHT,
  MOBILE_MIN_WIDGET_WIDTH,
  MOBILE_MIN_WIDGET_HEIGHT,
  MOBILE_CAP_WIDTH,
  MOBILE_CAP_HEIGHT,
  MOBILE_DEFAULT_CALENDAR_WIDTH,
  MOBILE_DEFAULT_CALENDAR_HEIGHT,
  MOBILE_MIN_CALENDAR_WIDTH,
  MOBILE_MIN_CALENDAR_HEIGHT,
  WIDGET_GRID_SIZE,
} from "./types";
import { useIsMobile } from "../../utils/useIsMobile";
import { aggregateValue, isGoalMet, today } from "./aggregate";
import CalendarView from "./CalendarView";
import styles from "./TrendsWidget.module.css";

interface TrendsWidgetProps {
  widget: TrendsWidgetConfig;
  metric: TrendMetricDef | undefined;
  days: string[];
  whoopHistory: HealthCalendarDay[];
  weightByDate: Map<string, number>;
  weightUnit: string;
  bmiByDate: Map<string, number>;
  onViewTypeChange: (viewType: TrendsViewType) => void;
  onColorChange: (color: string) => void;
  onMove: (x: number, y: number) => void;
  onResize: (width: number, height: number) => void;
  onResizingChange: (resizing: boolean) => void;
  onRemove: () => void;
  // Phone layout: full-width in normal document flow instead of absolutely
  // positioned at widget.x/y - see DashboardWidget's identical prop.
  stacked?: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onReorder?: (direction: "up" | "down") => void;
}

const VIEW_LABEL: Record<TrendsViewType, string> = {
  day: "Today",
  week: "This week",
  month: "This month",
  calendar: "Calendar",
  healthCalendar: "Health Calendar",
};

const HEADER_HEIGHT = 40;
const CONTENT_PADDING = 32;

export default function TrendsWidget({
  widget,
  metric,
  days,
  whoopHistory,
  weightByDate,
  weightUnit,
  bmiByDate,
  onViewTypeChange,
  onColorChange,
  onMove,
  onResize,
  onResizingChange,
  onRemove,
  stacked,
  canMoveUp,
  canMoveDown,
  onReorder,
}: TrendsWidgetProps) {
  const isCalendar = widget.viewType === "calendar";
  const isHealthCalendar = widget.viewType === "healthCalendar";
  const needsCalendarRoom = isCalendar || isHealthCalendar;
  const isMobile = useIsMobile();

  const minWidth = needsCalendarRoom
    ? isMobile
      ? MOBILE_MIN_CALENDAR_WIDTH
      : MIN_CALENDAR_WIDTH
    : isMobile
      ? MOBILE_MIN_WIDGET_WIDTH
      : MIN_WIDGET_WIDTH;
  const minHeight = needsCalendarRoom
    ? isMobile
      ? MOBILE_MIN_CALENDAR_HEIGHT
      : MIN_CALENDAR_HEIGHT
    : isMobile
      ? MOBILE_MIN_WIDGET_HEIGHT
      : MIN_WIDGET_HEIGHT;
  const defaultWidth = needsCalendarRoom
    ? isMobile
      ? MOBILE_DEFAULT_CALENDAR_WIDTH
      : DEFAULT_CALENDAR_WIDTH
    : isMobile
      ? MOBILE_DEFAULT_WIDGET_WIDTH
      : DEFAULT_WIDGET_WIDTH;
  const defaultHeight = needsCalendarRoom
    ? isMobile
      ? MOBILE_DEFAULT_CALENDAR_HEIGHT
      : DEFAULT_CALENDAR_HEIGHT
    : isMobile
      ? MOBILE_DEFAULT_WIDGET_HEIGHT
      : DEFAULT_WIDGET_HEIGHT;
  // A stat widget already sized for desktop shows visually compressed on
  // mobile (the saved width/height itself is untouched) - either calendar
  // is exempt since it needs more room than the cap to stay legible.
  const capWidth = isMobile && !needsCalendarRoom ? MOBILE_CAP_WIDTH : Infinity;
  const capHeight = isMobile && !needsCalendarRoom ? MOBILE_CAP_HEIGHT : Infinity;

  const { rect, handleDragPointerDown, handleResizePointerDown, applyResize } = useCanvasItem({
    initial: {
      x: widget.x ?? 0,
      y: widget.y ?? 0,
      width: Math.max(minWidth, Math.min(widget.width ?? defaultWidth, capWidth)),
      height: Math.max(minHeight, Math.min(widget.height ?? defaultHeight, capHeight)),
    },
    minWidth,
    minHeight,
    gridSize: WIDGET_GRID_SIZE,
    onMove,
    onResize,
    onDraggingChange: onResizingChange,
  });

  // Switching view type to either calendar mid-session needs more room than
  // a stat widget's default - bump up (and persist) if the current size is
  // below the calendar minimum, matching what a freshly-added calendar
  // widget would get.
  useEffect(() => {
    if (needsCalendarRoom && (rect.width < minWidth || rect.height < minHeight)) {
      applyResize(Math.max(rect.width, defaultWidth), Math.max(rect.height, defaultHeight));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsCalendarRoom]);

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

  const color = widget.color ?? DEFAULT_TRENDS_COLOR;
  const contentHeight = Math.max(24, rect.height - HEADER_HEIGHT - CONTENT_PADDING);
  const positionStyle = stacked
    ? { width: rect.width, height: rect.height }
    : { position: "absolute" as const, left: rect.x, top: rect.y, width: rect.width, height: rect.height };

  return (
    <div
      ref={widgetRef}
      style={positionStyle}
      className={`${styles.widget} ${stacked ? styles.stacked : ""}`}
      data-selected={selected || undefined}
      onPointerDownCapture={() => setSelected(true)}
    >
      <div className={styles.header}>
        {!stacked && (
          <div className={styles.dragHandle} onPointerDown={handleDragPointerDown} role="button" tabIndex={0} aria-label="Drag to move">
            ⠿
          </div>
        )}
        <span className={styles.label}>{widget.label}</span>
        <div className={styles.controls}>
          {stacked && (
            <>
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => onReorder?.("up")}
                disabled={!canMoveUp}
                aria-label="Move widget up"
              >
                ▲
              </button>
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => onReorder?.("down")}
                disabled={!canMoveDown}
                aria-label="Move widget down"
              >
                ▼
              </button>
            </>
          )}
          <input
            type="color"
            className={styles.colorInput}
            value={color}
            onChange={(e) => onColorChange(e.target.value)}
            aria-label="Widget colour"
          />
          {!isHealthCalendar && (
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
          )}
          <button type="button" className={styles.iconButton} onClick={onRemove} aria-label="Remove widget">
            ×
          </button>
        </div>
      </div>

      <div className={styles.content}>
        {!metric ? (
          <p className={styles.empty}>Metric not available.</p>
        ) : isHealthCalendar ? (
          <HealthCalendar
            whoopHistory={whoopHistory}
            weightByDate={weightByDate}
            weightUnit={weightUnit}
            bmiByDate={bmiByDate}
            height={contentHeight}
          />
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
            const isWeight = isWeightMetricId(metric.id);
            const formatStatValue = (v: number) => (isWeight ? formatWeight(v) : v);

            return (
              <div className={styles.stat}>
                <div className={styles.statValue} style={{ color: valueColor }}>
                  {value != null ? `${formatStatValue(value)}${metric.unit}` : "—"}
                </div>
                {metric.isGoal && goal != null && (
                  <div className={styles.statGoal}>Goal: {formatStatValue(goal)}{metric.unit}</div>
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
