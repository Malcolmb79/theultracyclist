import { useEffect } from "react";
import { useCanvasItem } from "../../utils/useCanvasItem";
import { useLongPressSelect } from "../../utils/useLongPressSelect";
import type { TrendMetricDef } from "./useTrendsData";
import type { TrendsWidgetConfig, TrendsViewType } from "./types";
import HealthCalendar from "../dashboard/HealthCalendar";
import type { HealthCalendarDay } from "../dashboard/HealthDayDetailModal";
import PerformanceChart from "../dashboard/PerformanceChart";
import GoalProgress from "./GoalProgress";
import ProgressPhotos from "./ProgressPhotos";
import { PROGRESS_PHOTOS_ID, type DatedGoal } from "./types";
import type { PerformancePoint } from "../../utils/performanceSeries";
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
import { aggregateValue, datesInRange, isGoalMet, today } from "./aggregate";
import CalendarView from "./CalendarView";
import WeekBarChart from "./WeekBarChart";
import styles from "./TrendsWidget.module.css";

interface TrendsWidgetProps {
  widget: TrendsWidgetConfig;
  metric: TrendMetricDef | undefined;
  days: string[];
  whoopHistory: HealthCalendarDay[];
  weightByDate: Map<string, number>;
  /** Apple Health weight readings in display units, for the goal chart. */
  weightSeries?: { date: string; value: number }[];
  weightUnit: string;
  bmiByDate: Map<string, number>;
  performanceSeries: PerformancePoint[];
  /** Set when this widget shows a goal with a deadline rather than a metric. */
  datedGoal?: DatedGoal;
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
  performanceChart: "Performance Chart",
  goalProgress: "Goal progress",
  progressPhotos: "Progress photos",
};

// The selectable time ranges, shown as an always-visible pill row inside
// the widget content instead of a header dropdown - "healthCalendar" isn't
// included since that's a different fixed widget type entirely, not a view
// of a real metric (see the isHealthCalendar guard around its usage below).
const VIEW_PILL_TYPES: TrendsViewType[] = ["day", "week", "month", "calendar"];

// A goal-backed widget gets one more pill, first, because the progress view is
// what its target was set for. Without it a widget saved before that view
// existed keeps whichever range it had and has no way to reach it — which is
// exactly what happened to the weight goal.
const GOAL_PILL_TYPES: TrendsViewType[] = ["goalProgress", ...VIEW_PILL_TYPES];

const VIEW_PILL_LABEL: Record<TrendsViewType, string> = {
  day: "Daily",
  week: "Mon-Sun",
  month: "Monthly",
  calendar: "Calendar",
  healthCalendar: "Health Calendar",
  performanceChart: "Performance Chart",
  goalProgress: "Goal",
  progressPhotos: "Photos",
};

const HEADER_HEIGHT = 40;
const CONTENT_PADDING = 32;
// Pill row height (padding + button + margin-bottom, see .viewSegmented in
// the stylesheet) - shown for every view except healthCalendar, so
// CalendarView's own height allowance needs to account for it or it'll be
// told it has more room than .contentBody actually leaves it.
const VIEW_SEGMENTED_HEIGHT = 38;

export default function TrendsWidget({
  widget,
  metric,
  days,
  whoopHistory,
  weightByDate,
  weightSeries = [],
  weightUnit,
  bmiByDate,
  performanceSeries,
  datedGoal,
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
  const isPerformanceChart = widget.viewType === "performanceChart";
  const isGoalProgress = widget.viewType === "goalProgress";
  const isProgressPhotos = widget.metric === PROGRESS_PHOTOS_ID;
  // Weight is the goal with a real history behind it: one reading per day the
  // scales were used, straight from Apple Health. FTP is a tested figure with
  // no series, and the sleep goal counts nights rather than tracking toward a
  // date — both fall back to the bar.
  const goalSeries = isGoalProgress && isWeightMetricId(widget.metric) ? weightSeries : [];
  const needsCalendarRoom = isCalendar || isHealthCalendar;
  // Performance chart's multi-line plot + legend needs similarly generous
  // room to either calendar, so it reuses the same wider min/default sizing
  // rather than a third set of size constants.
  const needsWideRoom = needsCalendarRoom || isPerformanceChart || isProgressPhotos;
  const isMobile = useIsMobile();

  const minWidth = needsWideRoom
    ? isMobile
      ? MOBILE_MIN_CALENDAR_WIDTH
      : MIN_CALENDAR_WIDTH
    : isMobile
      ? MOBILE_MIN_WIDGET_WIDTH
      : MIN_WIDGET_WIDTH;
  const minHeight = needsWideRoom
    ? isMobile
      ? MOBILE_MIN_CALENDAR_HEIGHT
      : MIN_CALENDAR_HEIGHT
    : isMobile
      ? MOBILE_MIN_WIDGET_HEIGHT
      : MIN_WIDGET_HEIGHT;
  const defaultWidth = needsWideRoom
    ? isMobile
      ? MOBILE_DEFAULT_CALENDAR_WIDTH
      : DEFAULT_CALENDAR_WIDTH
    : isMobile
      ? MOBILE_DEFAULT_WIDGET_WIDTH
      : DEFAULT_WIDGET_WIDTH;
  const defaultHeight = needsWideRoom
    ? isMobile
      ? MOBILE_DEFAULT_CALENDAR_HEIGHT
      : DEFAULT_CALENDAR_HEIGHT
    : isMobile
      ? MOBILE_DEFAULT_WIDGET_HEIGHT
      : DEFAULT_WIDGET_HEIGHT;
  // A stat widget already sized for desktop shows visually compressed on
  // mobile (the saved width/height itself is untouched) - either calendar
  // is exempt since it needs more room than the cap to stay legible. Not
  // applied in stacked (flow) mode - see DashboardWidget.tsx's identical
  // reasoning for why that would just fight a deliberate resize.
  const capWidth = isMobile && !stacked && !needsWideRoom ? MOBILE_CAP_WIDTH : Infinity;
  const capHeight = isMobile && !stacked && !needsWideRoom ? MOBILE_CAP_HEIGHT : Infinity;

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

  const { ref: widgetRef, selected, pressHandlers } = useLongPressSelect<HTMLDivElement>();

  const color = widget.color ?? DEFAULT_TRENDS_COLOR;
  const contentHeight = Math.max(
    24,
    rect.height - HEADER_HEIGHT - CONTENT_PADDING - (isHealthCalendar || isPerformanceChart || isProgressPhotos ? 0 : VIEW_SEGMENTED_HEIGHT),
  );
  const positionStyle = stacked
    ? { width: rect.width, height: rect.height }
    : { position: "absolute" as const, left: rect.x, top: rect.y, width: rect.width, height: rect.height };

  return (
    <div
      ref={widgetRef}
      style={positionStyle}
      className={`${styles.widget} ${stacked ? styles.stacked : ""}`}
      data-selected={selected || undefined}
      {...pressHandlers}
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
          <button
            type="button"
            className={styles.iconButton}
            onClick={(e) => {
              // Blur before removing - on iOS Safari, removing the still-
              // focused button from the DOM makes focus fall back to
              // <body>, which scrolls the whole page to the top instead of
              // leaving the scroll position where it was.
              e.currentTarget.blur();
              onRemove();
            }}
            aria-label="Remove widget"
          >
            ×
          </button>
        </div>
      </div>

      <div className={styles.content}>
        {!isHealthCalendar && !isPerformanceChart && !isProgressPhotos && (
          <div className={styles.viewSegmented} role="radiogroup" aria-label="Time range">
            {(datedGoal ? GOAL_PILL_TYPES : VIEW_PILL_TYPES).map((vt) => (
              <button
                key={vt}
                type="button"
                role="radio"
                aria-checked={widget.viewType === vt}
                className={`${styles.viewSegmentButton} ${widget.viewType === vt ? styles.viewSegmentButtonActive : ""}`}
                onClick={() => onViewTypeChange(vt)}
              >
                {VIEW_PILL_LABEL[vt]}
              </button>
            ))}
          </div>
        )}
        <div className={styles.contentBody}>
        {isProgressPhotos ? (
          <ProgressPhotos latestWeightKg={datedGoal?.current ?? null} weightUnitLabel={datedGoal?.unit} />
        ) : !metric ? (
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
        ) : isPerformanceChart ? (
          <PerformanceChart data={performanceSeries} availableHeight={contentHeight} />
        ) : isGoalProgress && datedGoal ? (
          <GoalProgress goal={datedGoal} todayIso={today()} series={goalSeries} />
        ) : widget.viewType === "week" ? (
          (() => {
            const anchor = today();
            const isWeight = isWeightMetricId(metric.id);
            const formatStatValue = (v: number) => (isWeight ? formatWeight(v) : v);
            return (
              <WeekBarChart
                metric={metric}
                dates={datesInRange(days, "week", anchor)}
                color={color}
                formatValue={(v) => `${formatStatValue(v)}${metric.unit}`}
                height={contentHeight}
              />
            );
          })()
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
