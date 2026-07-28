import { useEffect, useState } from "react";
import { formatDate } from "../../utils/formatDate";
import { relativeDayLabel } from "../../utils/relativeDate";
import { recoveryColor } from "../../utils/recoveryColor";
import { irelandTodayDateStr } from "../../utils/irelandDate";
import { estimateCalorieBurnNow, DEFAULT_CALORIE_BURN_ESTIMATE } from "../../utils/estimateCalorieBurn";
import { useIsMobile } from "../../utils/useIsMobile";
import { useMeasuredWidth } from "../../utils/useMeasuredWidth";
import { useCanvasItem } from "../../utils/useCanvasItem";
import { useLongPressSelect } from "../../utils/useLongPressSelect";
import DashboardStatTile from "./DashboardStatTile";
import TrendChart, { TREND_CHART_LABEL_TOP_PAD, TREND_CHART_LABEL_BOTTOM_PAD } from "../recovery/TrendChart";
import RingGauge from "./RingGauge";
import BmiChart from "./BmiChart";
import HealthCalendar from "./HealthCalendar";
import CaloriesBalanceCard from "./CaloriesBalanceCard";
import PerformanceChart from "./PerformanceChart";
import WeatherCard from "./WeatherCard";
import GarminLiveTrackCard from "./GarminLiveTrackCard";
import type { PerformancePoint } from "../../utils/performanceSeries";
import { bmiCategoryColor, isWeightMetricId } from "../../utils/bmi";
import { hrvReadinessColor } from "../../utils/hrvColor";
import WhoopDetailModal, { type WhoopDetailKind } from "./WhoopDetailModal";
import type { MetricDef, WhoopDay } from "./useDashboardData";
import {
  WHOOP_STRAIN_RECOVERY_COMBO_ID,
  WHOOP_RINGS_COMBO_ID,
  HEALTH_CALENDAR_ID,
  CALORIES_BALANCE_ID,
  PERFORMANCE_CHART_ID,
  WEATHER_ID,
  GARMIN_LIVETRACK_ID,
  DEFAULT_WIDGET_WIDTH,
  DEFAULT_WIDGET_HEIGHT,
  DEFAULT_WIDGET_COLOR,
  MIN_WIDGET_WIDTH,
  MIN_WIDGET_HEIGHT,
  MOBILE_DEFAULT_WIDGET_WIDTH,
  MOBILE_DEFAULT_WIDGET_HEIGHT,
  MOBILE_MIN_WIDGET_WIDTH,
  MOBILE_MIN_WIDGET_HEIGHT,
  MOBILE_CAP_WIDTH,
  MOBILE_CAP_HEIGHT,
  WIDGET_GRID_SIZE,
  type Widget,
} from "./types";
import styles from "./DashboardWidget.module.css";

interface DashboardWidgetProps {
  widget: Widget;
  metricById: Map<string, MetricDef>;
  whoopHistory: WhoopDay[];
  performanceSeries: PerformancePoint[];
  onViewTypeChange: (viewType: Widget["viewType"]) => void;
  onColorChange: (color: string) => void;
  onLabelChange: (label: string) => void;
  onMove: (x: number, y: number) => void;
  onResize: (width: number, height: number) => void;
  onResizingChange: (resizing: boolean) => void;
  onRemove: () => void;
  // Phone layout: renders full-width in normal document flow instead of
  // absolutely positioned at widget.x/y (see DashboardPage's `stacked`
  // branch) - reordering happens via onReorder instead of dragging.
  stacked?: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onReorder?: (direction: "up" | "down") => void;
  // Settings-driven config for the Calories Balance widget's live
  // "estimated" burn fallback - see estimateCalorieBurn.ts. Optional since
  // most widget types never read it; falls back to
  // DEFAULT_CALORIE_BURN_ESTIMATE per-field when unset.
  caloriesBurnSettings?: { wakeTime?: string; targetKcal?: number; targetTime?: string };
}

// Maps a widget's underlying metric id to the Whoop detail view it should
// open on click, matching Whoop's own app behavior of tapping a ring to see
// its breakdown. Only these three metrics have a matching detail view.
const DETAIL_KIND_BY_METRIC: Record<string, WhoopDetailKind> = {
  "whoop.strain": "strain",
  "whoop.recovery": "recovery",
  "whoop.sleepPerformance": "sleep",
};

const HEADER_HEIGHT = 44;
const CONTENT_PADDING = 32;
const MIN_COMBO_HEIGHT = 360;
// .widget's own horizontal chrome eaten from rect.width before any content
// gets to use it: padding var(--space-4) (24px) on each side plus its 1px
// border on each side - 48 alone (padding only) under-counts this by 2px,
// which was enough to clip the rightmost ring at the widget's stated
// minimum width.
const WIDGET_HORIZONTAL_CHROME = 24 * 2 + 1 * 2;
const MIN_RINGS_HEIGHT = 210;
// .ringsRow's gap between each of the 3 rings at a comfortable width - the
// outer two rings overflow their column and get clipped by .content's
// overflow:hidden if this isn't subtracted from the available row width.
const RINGS_ROW_GAP = 16; // matches var(--space-3), the CSS fallback
const MIN_RINGS_ROW_GAP = 4;
// Below this measured width the gap is already at its floor; above this,
// full-size RINGS_ROW_GAP. Matches the width band where the rings
// themselves are being squeezed toward their own 60px floor, so shrinking
// the gap actually buys them room instead of shrinking two things at once
// for no benefit.
const RINGS_GAP_SHRINK_START = 260;
const RINGS_GAP_SHRINK_END = 400;
// RingGauge's own .wrap gap (var(--space-2), 8px) plus its label row's
// rendered height (~20px for the uppercase small-caps text underneath).
const RING_LABEL_OVERHEAD = 28;
// 3 rings at their smallest (60px, see RingsRow's ringSize floor) plus the
// 2 row gaps (at their floor) plus the widget's own horizontal chrome -
// below this width the rings would be forced smaller than their floor and
// clip.
const MIN_RINGS_WIDTH = 3 * 60 + MIN_RINGS_ROW_GAP * 2 + WIDGET_HORIZONTAL_CHROME;

// Shrinks the gap between rings as the widget gets smaller, so at the
// smallest sizes the rings themselves get more of the available width
// instead of a fixed 16px gap eating into it regardless of how cramped
// the widget already is.
function ringsRowGap(measuredWidth: number): number {
  if (measuredWidth >= RINGS_GAP_SHRINK_END) return RINGS_ROW_GAP;
  if (measuredWidth <= RINGS_GAP_SHRINK_START) return MIN_RINGS_ROW_GAP;
  const t = (measuredWidth - RINGS_GAP_SHRINK_START) / (RINGS_GAP_SHRINK_END - RINGS_GAP_SHRINK_START);
  return Math.round(MIN_RINGS_ROW_GAP + t * (RINGS_ROW_GAP - MIN_RINGS_ROW_GAP));
}
// Per combo section overhead: comboLabel row (~20px) + TrendChart's own
// top/bottom padding for point labels and date labels (36px), times 2
// sections, plus the gap between them (var(--space-3), 16px).
const COMBO_SECTION_OVERHEAD = 2 * (20 + 36) + 16;
// BmiChart's content (headline + bar + ticks + caption, each with their own
// gaps) needs more vertical room than a plain stat/chart widget's floor -
// at the old generic MIN_WIDGET_HEIGHT the headline got clipped against
// .content's overflow:hidden.
const MIN_BMI_HEIGHT = 220;
const MIN_BMI_WIDTH = 220;
const MIN_HEALTH_CALENDAR_WIDTH = 420;
const MIN_HEALTH_CALENDAR_HEIGHT = 440;
const DEFAULT_HEALTH_CALENDAR_WIDTH = 480;
const DEFAULT_HEALTH_CALENDAR_HEIGHT = 480;
// CaloriesBalanceCard has two label/value/bar rows plus a net line and
// caption - more vertical content than BMI's single bar, so it gets its
// own (slightly taller) floor rather than clipping at MIN_BMI_HEIGHT.
const MIN_CALORIES_HEIGHT = 240;
const MIN_CALORIES_WIDTH = 220;
// Performance chart needs real width for the 5-line PMC plot plus a
// 3-line legend to stay readable, so it gets a wider floor/default than a
// plain stat/chart widget.
const MIN_PERFORMANCE_HEIGHT = 260;
const MIN_PERFORMANCE_WIDTH = 360;
const DEFAULT_PERFORMANCE_WIDTH = 440;
const DEFAULT_PERFORMANCE_HEIGHT = 300;
// The redesigned card (hero icon, live clock, wind direction, 7-day
// forecast strip) needs more room than a plain stat tile to stay legible.
const MIN_WEATHER_HEIGHT = 260;
const MIN_WEATHER_WIDTH = 300;
const DEFAULT_WEATHER_WIDTH = 340;
const DEFAULT_WEATHER_HEIGHT = 320;
// A live map needs real room to be useful - similar floor/default to the
// health calendar's generous sizing.
const MIN_GARMIN_HEIGHT = 320;
const MIN_GARMIN_WIDTH = 340;
const DEFAULT_GARMIN_WIDTH = 440;
const DEFAULT_GARMIN_HEIGHT = 400;

function formatValue(value: number, unit: string): string {
  const rounded = Number.isInteger(value) ? value : Math.round(value * 10) / 10;
  return unit ? `${rounded.toLocaleString("en-GB")} ${unit}` : rounded.toLocaleString("en-GB");
}

// Recovery's ring is always health-semantic (red/amber/green banding) and
// never overridden by the widget's custom color - everything else is purely
// decorative and defers to the custom color when the user has set one.
function ringColor(metric: MetricDef, value: number, customColor?: string): string {
  if (metric.id === "whoop.recovery") return recoveryColor(value);
  if (customColor) return customColor;
  if (metric.id === "whoop.sleepPerformance") return "#8FA9C5";
  if (metric.id === "whoop.strain") return "#4B87F5";
  return "var(--color-accent-2)";
}

function ringPercent(metric: MetricDef, value: number): number {
  if (metric.unit === "%") return value;
  if (metric.id === "whoop.strain") return (value / 21) * 100;
  return Math.min(100, value);
}

export default function DashboardWidget({
  widget,
  metricById,
  whoopHistory,
  performanceSeries,
  onViewTypeChange,
  onColorChange,
  onLabelChange,
  onMove,
  onResize,
  onResizingChange,
  onRemove,
  stacked,
  canMoveUp,
  canMoveDown,
  onReorder,
  caloriesBurnSettings,
}: DashboardWidgetProps) {
  const isCombo = widget.metric === WHOOP_STRAIN_RECOVERY_COMBO_ID;
  const isRings = widget.metric === WHOOP_RINGS_COMBO_ID;
  const isBmi = widget.metric === "health.bmi";
  const isHealthCalendar = widget.metric === HEALTH_CALENDAR_ID;
  const isCaloriesBalance = widget.metric === CALORIES_BALANCE_ID;

  // Ticks every minute so the estimated-burn fallback below visibly climbs
  // through the day while the page is left open, same pattern as
  // WeatherCard's own live clock - only actually running for the one
  // widget type that needs it.
  const [estimateNow, setEstimateNow] = useState(() => new Date());
  useEffect(() => {
    if (!isCaloriesBalance) return;
    const interval = setInterval(() => setEstimateNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, [isCaloriesBalance]);
  const isPerformanceChart = widget.metric === PERFORMANCE_CHART_ID;
  const isWeather = widget.metric === WEATHER_ID;
  const isGarminLiveTrack = widget.metric === GARMIN_LIVETRACK_ID;
  const detailKind = DETAIL_KIND_BY_METRIC[widget.metric];
  const [openDetail, setOpenDetail] = useState<WhoopDetailKind | null>(null);
  const metric =
    isCombo || isRings || isHealthCalendar || isCaloriesBalance || isPerformanceChart || isWeather || isGarminLiveTrack
      ? undefined
      : metricById.get(widget.metric);
  const isMobile = useIsMobile();

  // The weight widget's color is always health-semantic (matches the BMI
  // widget's own red/amber/green banding for the current BMI) rather than
  // the custom color picker, same precedent as the recovery ring below.
  const latestBmi = metricById.get("health.bmi")?.series.at(-1)?.value;
  const isWeightWidget = metric ? isWeightMetricId(metric.id) : false;
  // HRV has no universal "good" number, so it's banded by deviation from
  // the athlete's own recent baseline rather than a fixed value - see
  // hrvColor.ts for the reasoning.
  const isHrvWidget = metric?.id === "whoop.hrv";
  const effectiveColor = isWeightWidget && latestBmi != null
    ? bmiCategoryColor(latestBmi)
    : isHrvWidget && metric && metric.series.length >= 2
      ? hrvReadinessColor(metric.series.map((p) => p.value))
      : widget.color;

  // For the health calendar: weight is shown in whatever unit its own
  // metric is already display-converted to (no extra conversion needed
  // here), while BMI per day comes straight from the already-computed
  // "health.bmi" series so the calendar doesn't need height/weight math
  // of its own.
  const weightMetric = Array.from(metricById.values()).find((m) => isWeightMetricId(m.id));
  const weightByDate = new Map((weightMetric?.series ?? []).map((p) => [p.date.slice(0, 10), p.value]));
  const weightUnit = weightMetric?.unit ?? "kg";
  const bmiByDate = new Map((metricById.get("health.bmi")?.series ?? []).map((p) => [p.date.slice(0, 10), p.value]));

  // For calories balance: "burned" is active energy plus basal/resting
  // energy when the export includes it (falls back to active-only if not).
  const allMetrics = Array.from(metricById.values());
  const consumedMetric = allMetrics.find((m) => /dietary_energy/i.test(m.id));
  const activeMetric = allMetrics.find((m) => /active_energy/i.test(m.id));
  const basalMetric = allMetrics.find((m) => /basal_energy|resting_energy/i.test(m.id));
  const consumedByDate = new Map((consumedMetric?.series ?? []).map((p) => [p.date.slice(0, 10), p.value]));
  const activeByDate = new Map((activeMetric?.series ?? []).map((p) => [p.date.slice(0, 10), p.value]));
  const basalByDate = new Map((basalMetric?.series ?? []).map((p) => [p.date.slice(0, 10), p.value]));
  const today = irelandTodayDateStr();
  // Falls back to a live estimate (see estimateCalorieBurn.ts) only when
  // there's no real Active/Basal Energy reading for TODAY specifically -
  // any real number, even a partial same-day one, always wins over the
  // estimate. Checked directly against today's date in the burn metrics
  // themselves, rather than via the latest date across all three metrics
  // combined - Consumed often syncs on its own schedule, and its latest
  // date briefly outrunning Active/Basal's (e.g. a meal logged before the
  // day's workout syncs) used to make a real, already-synced burn total
  // for today look absent and fall back to the estimate.
  const realBurnedToday =
    activeByDate.has(today) || basalByDate.has(today) ? (activeByDate.get(today) ?? 0) + (basalByDate.get(today) ?? 0) : null;
  const hasRealBurnToday = realBurnedToday != null;
  const estimatedBurnedToday = !hasRealBurnToday
    ? estimateCalorieBurnNow(
        {
          wakeTime: caloriesBurnSettings?.wakeTime ?? DEFAULT_CALORIE_BURN_ESTIMATE.wakeTime,
          targetTime: caloriesBurnSettings?.targetTime ?? DEFAULT_CALORIE_BURN_ESTIMATE.targetTime,
          dailyTargetKcal: caloriesBurnSettings?.targetKcal ?? DEFAULT_CALORIE_BURN_ESTIMATE.dailyTargetKcal,
        },
        estimateNow,
      )
    : null;
  // Past-day fallback (no real burn today and no estimate settings resolve
  // one) - the latest day that Active/Basal actually has a reading for,
  // not blended with Consumed's own latest sync date for the same reason
  // as above.
  const burnDates = [...activeByDate.keys(), ...basalByDate.keys()].sort();
  const latestBurnDate = burnDates.at(-1) ?? null;
  const realBurnedLatest =
    latestBurnDate && (activeByDate.has(latestBurnDate) || basalByDate.has(latestBurnDate))
      ? (activeByDate.get(latestBurnDate) ?? 0) + (basalByDate.get(latestBurnDate) ?? 0)
      : null;
  const burnedLatest = hasRealBurnToday ? realBurnedToday : (estimatedBurnedToday ?? realBurnedLatest);
  const isBurnedEstimated = !hasRealBurnToday && estimatedBurnedToday != null;
  const caloriesDisplayDate = hasRealBurnToday || isBurnedEstimated ? today : latestBurnDate;
  // Consumed always tracks the date actually being displayed rather than
  // whichever of the three metrics last happened to sync - otherwise a live
  // burned estimate for today (see above) gets paired with yesterday's full
  // dietary total under a "Today" label, e.g. "1,652 kcal consumed" against
  // "36 kcal burned" at 7am, when nothing has been logged yet today.
  const consumedLatest = caloriesDisplayDate ? consumedByDate.get(caloriesDisplayDate) ?? null : null;

  const minHeight = isCombo
    ? MIN_COMBO_HEIGHT
    : isRings
      ? MIN_RINGS_HEIGHT
      : isBmi
        ? MIN_BMI_HEIGHT
        : isHealthCalendar
          ? MIN_HEALTH_CALENDAR_HEIGHT
          : isCaloriesBalance
            ? MIN_CALORIES_HEIGHT
            : isPerformanceChart
              ? MIN_PERFORMANCE_HEIGHT
              : isWeather
                ? MIN_WEATHER_HEIGHT
                : isGarminLiveTrack
                  ? MIN_GARMIN_HEIGHT
                  : isMobile
                    ? MOBILE_MIN_WIDGET_HEIGHT
                    : MIN_WIDGET_HEIGHT;
  const minWidth = isRings
    ? MIN_RINGS_WIDTH
    : isBmi
      ? MIN_BMI_WIDTH
      : isHealthCalendar
        ? MIN_HEALTH_CALENDAR_WIDTH
        : isCaloriesBalance
          ? MIN_CALORIES_WIDTH
          : isPerformanceChart
            ? MIN_PERFORMANCE_WIDTH
            : isWeather
              ? MIN_WEATHER_WIDTH
              : isGarminLiveTrack
                ? MIN_GARMIN_WIDTH
                : isMobile
                  ? MOBILE_MIN_WIDGET_WIDTH
                  : MIN_WIDGET_WIDTH;
  const defaultWidth = isHealthCalendar
    ? DEFAULT_HEALTH_CALENDAR_WIDTH
    : isPerformanceChart
      ? DEFAULT_PERFORMANCE_WIDTH
      : isGarminLiveTrack
        ? DEFAULT_GARMIN_WIDTH
        : isWeather
          ? DEFAULT_WEATHER_WIDTH
          : isMobile
            ? MOBILE_DEFAULT_WIDGET_WIDTH
            : DEFAULT_WIDGET_WIDTH;
  const defaultHeight = isHealthCalendar
    ? DEFAULT_HEALTH_CALENDAR_HEIGHT
    : isPerformanceChart
      ? DEFAULT_PERFORMANCE_HEIGHT
      : isGarminLiveTrack
        ? DEFAULT_GARMIN_HEIGHT
        : isWeather
          ? DEFAULT_WEATHER_HEIGHT
          : isMobile
            ? MOBILE_DEFAULT_WIDGET_HEIGHT
            : DEFAULT_WIDGET_HEIGHT;
  // A widget already sized for desktop shows visually compressed on mobile
  // (the saved width/height itself is untouched) - combo/rings/calendar are
  // exempt since they need more room than the cap to render their sub-content.
  // Not applied in stacked (flow) mode at all: that layout already clamps
  // real overflow via max-width:100% (see .stacked in the stylesheet), so
  // this cap would do nothing but fight a deliberate resize - re-clamping
  // it back down on every reload and making the resize look like it never
  // saved.
  const capWidth =
    isMobile && !stacked && !isRings && !isHealthCalendar && !isPerformanceChart && !isGarminLiveTrack && !isWeather
      ? MOBILE_CAP_WIDTH
      : Infinity;
  const capHeight =
    isMobile &&
    !stacked &&
    !isCombo &&
    !isRings &&
    !isHealthCalendar &&
    !isPerformanceChart &&
    !isGarminLiveTrack &&
    !isWeather
      ? MOBILE_CAP_HEIGHT
      : Infinity;

  const { rect, handleDragPointerDown, handleResizePointerDown } = useCanvasItem({
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

  // Drag handle and controls stay hidden until the widget is held for 3
  // seconds - tapping outside deselects again. See useLongPressSelect.
  const { ref: widgetRef, selected, pressHandlers } = useLongPressSelect<HTMLDivElement>();

  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(widget.label);

  useEffect(() => {
    setLabelDraft(widget.label);
  }, [widget.label]);

  const commitLabel = () => {
    const trimmed = labelDraft.trim();
    if (trimmed && trimmed !== widget.label) onLabelChange(trimmed);
    else setLabelDraft(widget.label);
    setEditingLabel(false);
  };

  // Stacked (phone/tablet) mode renders in normal document flow, wrapping
  // left-to-right (see .stackList in DashboardPage.module.css) instead of
  // absolute x/y - width/height still come from the resized rect so a
  // narrowed widget can sit next to another one, but .stacked's
  // max-width:100% (see the stylesheet) clamps it if it's wider than the
  // row so it can never force horizontal scrolling.
  const positionStyle = stacked
    ? { width: rect.width, height: rect.height }
    : {
        position: "absolute" as const,
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
      };

  const contentHeight = Math.max(24, rect.height - HEADER_HEIGHT - CONTENT_PADDING);
  // Measures the content area's actual rendered width rather than trusting
  // rect.width - in stacked mode the widget renders at 100% width via CSS
  // regardless of the stored rect.width, so a single ring's size needs the
  // real DOM width to avoid clipping or being sized for the wrong screen.
  const [contentRef, measuredContentWidth] = useMeasuredWidth(minWidth);
  const ringSize = Math.max(60, Math.min(measuredContentWidth, contentHeight) - 20);

  return (
    <>
      <div
        ref={widgetRef}
        style={positionStyle}
        className={`${styles.widget} ${stacked ? styles.stacked : ""}`}
        data-selected={selected || undefined}
        {...pressHandlers}
      >
        <div className={styles.header}>
          {!stacked && (
            <div
              className={styles.dragHandle}
              onPointerDown={handleDragPointerDown}
              role="button"
              tabIndex={0}
              aria-label="Drag to move"
            >
              ⠿
            </div>
          )}
          {editingLabel ? (
            <input
              className={styles.labelInput}
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              onBlur={commitLabel}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitLabel();
                if (e.key === "Escape") {
                  setLabelDraft(widget.label);
                  setEditingLabel(false);
                }
              }}
              autoFocus
            />
          ) : (
            <span className={styles.label} onClick={() => setEditingLabel(true)} title="Click to rename">
              {widget.label}
            </span>
          )}
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
              value={widget.color ?? DEFAULT_WIDGET_COLOR}
              onChange={(e) => onColorChange(e.target.value)}
              aria-label="Widget colour"
            />
            {!isCombo &&
              !isRings &&
              !isBmi &&
              !isHealthCalendar &&
              !isCaloriesBalance &&
              !isPerformanceChart &&
              !isWeather &&
              !isGarminLiveTrack && (
              <select
                className={styles.select}
                value={widget.viewType}
                onChange={(e) => onViewTypeChange(e.target.value as Widget["viewType"])}
              >
                <option value="stat">Stat</option>
                <option value="chart">Chart</option>
                <option value="ring">Ring</option>
                <option value="timeline">Timeline</option>
              </select>
            )}
            <button
              type="button"
              className={styles.iconButton}
              onClick={(e) => {
                // Blur before removing - on iOS Safari, removing the still-
                // focused button from the DOM makes focus fall back to
                // <body>, which scrolls the whole page to the top instead
                // of leaving the scroll position where it was.
                e.currentTarget.blur();
                onRemove();
              }}
              aria-label="Remove widget"
            >
              ×
            </button>
          </div>
        </div>

        <div
          ref={contentRef}
          className={`${styles.content} ${detailKind ? styles.clickable : ""}`}
          onClick={detailKind ? () => setOpenDetail(detailKind) : undefined}
          role={detailKind ? "button" : undefined}
          tabIndex={detailKind ? 0 : undefined}
        >
          {isCombo ? (
            <ComboStrainRecovery
              strain={metricById.get("whoop.strain")}
              recovery={metricById.get("whoop.recovery")}
              chartHeight={Math.max(24, (contentHeight - COMBO_SECTION_OVERHEAD) / 2)}
              strainColor={widget.color}
            />
          ) : isRings ? (
            <RingsRow
              latest={whoopHistory[whoopHistory.length - 1]}
              contentHeight={contentHeight}
              onOpenDetail={setOpenDetail}
            />
          ) : isBmi ? (
            <BmiChart
              bmi={metric?.series.length ? metric.series[metric.series.length - 1].value : null}
              date={metric?.series.length ? metric.series[metric.series.length - 1].date : null}
            />
          ) : isHealthCalendar ? (
            <HealthCalendar
              whoopHistory={whoopHistory}
              weightByDate={weightByDate}
              weightUnit={weightUnit}
              bmiByDate={bmiByDate}
              height={contentHeight}
            />
          ) : isCaloriesBalance ? (
            <CaloriesBalanceCard
              consumed={consumedLatest}
              burned={burnedLatest}
              date={caloriesDisplayDate}
              burnedEstimated={isBurnedEstimated}
            />
          ) : isPerformanceChart ? (
            <PerformanceChart data={performanceSeries} height={Math.max(80, contentHeight - 40)} />
          ) : isWeather ? (
            <WeatherCard />
          ) : isGarminLiveTrack ? (
            <GarminLiveTrackCard />
          ) : !metric || metric.series.length === 0 ? (
            <p className={styles.empty}>No data yet for this metric.</p>
          ) : widget.viewType === "stat" ? (
            <DashboardStatTile
              value={formatValue(metric.series[metric.series.length - 1].value, metric.unit)}
              label={relativeDayLabel(metric.series[metric.series.length - 1].date)}
              valueColor={effectiveColor}
            />
          ) : widget.viewType === "ring" ? (
            <RingGauge
              percent={ringPercent(metric, metric.series[metric.series.length - 1].value)}
              color={ringColor(metric, metric.series[metric.series.length - 1].value, effectiveColor)}
              centerValue={formatValue(metric.series[metric.series.length - 1].value, metric.unit)}
              label={relativeDayLabel(metric.series[metric.series.length - 1].date)}
              pixelSize={ringSize}
            />
          ) : widget.viewType === "chart" ? (
            metric.series.length > 1 ? (
              <TrendChart
                points={metric.series}
                height={Math.max(24, contentHeight - TREND_CHART_LABEL_TOP_PAD - TREND_CHART_LABEL_BOTTOM_PAD)}
                color={effectiveColor}
                pointLabel={(p) => formatValue(p.value, "")}
                showDates
              />
            ) : (
              <p className={styles.empty}>Need at least 2 data points for a chart.</p>
            )
          ) : (
            <ul className={styles.timeline}>
              {metric.series
                .slice()
                .reverse()
                .slice(0, 10)
                .map((point) => (
                  <li key={point.date} className={styles.timelineRow}>
                    <span>{formatDate(point.date)}</span>
                    <span style={effectiveColor ? { color: effectiveColor } : undefined}>
                      {formatValue(point.value, metric.unit)}
                    </span>
                  </li>
                ))}
            </ul>
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
      {openDetail && <WhoopDetailModal kind={openDetail} history={whoopHistory} onClose={() => setOpenDetail(null)} />}
    </>
  );
}

function RingsRow({
  latest,
  contentHeight,
  onOpenDetail,
}: {
  latest: WhoopDay | undefined;
  contentHeight: number;
  onOpenDetail: (kind: WhoopDetailKind) => void;
}) {
  // Measures the row's actual rendered width rather than back-computing it
  // from the widget's outer size minus assumed padding/border/gap constants
  // - that arithmetic drifted out of sync with the real CSS (missed the
  // widget's 1px border) and clipped the rightmost ring at small sizes.
  const [containerRef, measuredWidth] = useMeasuredWidth(MIN_RINGS_WIDTH);

  if (!latest || (!latest.sleep && !latest.recovery && !latest.strain)) {
    return <p className={styles.empty}>No data yet for this metric.</p>;
  }

  const gap = ringsRowGap(measuredWidth);
  const ringSize = Math.max(60, Math.min((measuredWidth - gap * 2) / 3, contentHeight - RING_LABEL_OVERHEAD));

  return (
    <div className={styles.ringsRow} ref={containerRef} style={{ gap }}>
      {latest.sleep && (
        <button type="button" className={styles.ringButton} onClick={() => onOpenDetail("sleep")}>
          <RingGauge
            percent={latest.sleep.performancePercent}
            color="#8FA9C5"
            centerValue={`${latest.sleep.performancePercent}%`}
            label="SLEEP"
            pixelSize={ringSize}
          />
        </button>
      )}
      {latest.recovery && (
        <button type="button" className={styles.ringButton} onClick={() => onOpenDetail("recovery")}>
          <RingGauge
            percent={latest.recovery.score}
            color={recoveryColor(latest.recovery.score)}
            centerValue={`${latest.recovery.score}%`}
            label="RECOVERY"
            pixelSize={ringSize}
          />
        </button>
      )}
      {latest.strain && (
        <button type="button" className={styles.ringButton} onClick={() => onOpenDetail("strain")}>
          <RingGauge
            percent={(latest.strain.score / 21) * 100}
            color="#4B87F5"
            centerValue={latest.strain.score.toFixed(1)}
            label="STRAIN"
            pixelSize={ringSize}
          />
        </button>
      )}
    </div>
  );
}

const COMBO_DAYS = 7;

function ComboStrainRecovery({
  strain,
  recovery,
  chartHeight,
  strainColor,
}: {
  strain: MetricDef | undefined;
  recovery: MetricDef | undefined;
  chartHeight: number;
  strainColor?: string;
}) {
  if (!strain?.series.length || !recovery?.series.length) {
    return <p className={styles.empty}>No data yet for this metric.</p>;
  }

  const strainWeek = strain.series.slice(-COMBO_DAYS);
  const recoveryWeek = recovery.series.slice(-COMBO_DAYS);
  const resolvedStrainColor = strainColor ?? "#4B87F5";

  return (
    <div className={styles.combo}>
      <div>
        <span className={styles.comboLabel}>Strain</span>
        {strainWeek.length > 1 ? (
          <TrendChart
            points={strainWeek}
            pointColor={() => resolvedStrainColor}
            pointLabel={(p) => p.value.toFixed(1)}
            showDates
            height={chartHeight}
            color={resolvedStrainColor}
            showArea={false}
          />
        ) : (
          <p className={styles.empty}>Not enough data yet.</p>
        )}
      </div>
      <div>
        <span className={styles.comboLabel}>Recovery</span>
        {recoveryWeek.length > 1 ? (
          <TrendChart
            points={recoveryWeek}
            pointColor={(p) => recoveryColor(p.value)}
            pointLabel={(p) => `${Math.round(p.value)}%`}
            showDates
            height={chartHeight}
          />
        ) : (
          <p className={styles.empty}>Not enough data yet.</p>
        )}
      </div>
    </div>
  );
}
