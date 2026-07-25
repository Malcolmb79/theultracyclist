import { useEffect, useRef, useState } from "react";
import { formatDate } from "../../utils/formatDate";
import { recoveryColor } from "../../utils/recoveryColor";
import { useIsMobile } from "../../utils/useIsMobile";
import { useMeasuredWidth } from "../../utils/useMeasuredWidth";
import { useCanvasItem } from "../../utils/useCanvasItem";
import DashboardStatTile from "./DashboardStatTile";
import TrendChart, { TREND_CHART_LABEL_TOP_PAD, TREND_CHART_LABEL_BOTTOM_PAD } from "../recovery/TrendChart";
import RingGauge from "./RingGauge";
import BmiChart from "./BmiChart";
import HealthCalendar from "./HealthCalendar";
import { bmiCategoryColor, isWeightMetricId } from "../../utils/bmi";
import WhoopDetailModal, { type WhoopDetailKind } from "./WhoopDetailModal";
import type { MetricDef, WhoopDay } from "./useDashboardData";
import {
  WHOOP_STRAIN_RECOVERY_COMBO_ID,
  WHOOP_RINGS_COMBO_ID,
  HEALTH_CALENDAR_ID,
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
  onViewTypeChange: (viewType: Widget["viewType"]) => void;
  onColorChange: (color: string) => void;
  onMove: (x: number, y: number) => void;
  onResize: (width: number, height: number) => void;
  onResizingChange: (resizing: boolean) => void;
  onRemove: () => void;
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
// .ringsRow's gap (var(--space-3), 16px) between each of the 3 rings - the
// outer two rings overflow their column and get clipped by .content's
// overflow:hidden if this isn't subtracted from the available row width.
const RINGS_ROW_GAP = 16;
// RingGauge's own .wrap gap (var(--space-2), 8px) plus its label row's
// rendered height (~20px for the uppercase small-caps text underneath).
const RING_LABEL_OVERHEAD = 28;
// 3 rings at their smallest (60px, see RingsRow's ringSize floor) plus the
// 2 row gaps plus the widget's own horizontal chrome - below this width
// the rings would be forced smaller than their floor and clip.
const MIN_RINGS_WIDTH = 3 * 60 + RINGS_ROW_GAP * 2 + WIDGET_HORIZONTAL_CHROME;
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

function formatValue(value: number, unit: string): string {
  const rounded = Number.isInteger(value) ? value : Math.round(value * 10) / 10;
  return unit ? `${rounded.toLocaleString()} ${unit}` : rounded.toLocaleString();
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
  onViewTypeChange,
  onColorChange,
  onMove,
  onResize,
  onResizingChange,
  onRemove,
}: DashboardWidgetProps) {
  const isCombo = widget.metric === WHOOP_STRAIN_RECOVERY_COMBO_ID;
  const isRings = widget.metric === WHOOP_RINGS_COMBO_ID;
  const isBmi = widget.metric === "health.bmi";
  const isHealthCalendar = widget.metric === HEALTH_CALENDAR_ID;
  const detailKind = DETAIL_KIND_BY_METRIC[widget.metric];
  const [openDetail, setOpenDetail] = useState<WhoopDetailKind | null>(null);
  const metric = isCombo || isRings || isHealthCalendar ? undefined : metricById.get(widget.metric);
  const isMobile = useIsMobile();

  // The weight widget's color is always health-semantic (matches the BMI
  // widget's own red/amber/green banding for the current BMI) rather than
  // the custom color picker, same precedent as the recovery ring below.
  const latestBmi = metricById.get("health.bmi")?.series.at(-1)?.value;
  const isWeightWidget = metric ? isWeightMetricId(metric.id) : false;
  const effectiveColor = isWeightWidget && latestBmi != null ? bmiCategoryColor(latestBmi) : widget.color;

  // For the health calendar: weight is shown in whatever unit its own
  // metric is already display-converted to (no extra conversion needed
  // here), while BMI per day comes straight from the already-computed
  // "health.bmi" series so the calendar doesn't need height/weight math
  // of its own.
  const weightMetric = Array.from(metricById.values()).find((m) => isWeightMetricId(m.id));
  const weightByDate = new Map((weightMetric?.series ?? []).map((p) => [p.date.slice(0, 10), p.value]));
  const weightUnit = weightMetric?.unit ?? "kg";
  const bmiByDate = new Map((metricById.get("health.bmi")?.series ?? []).map((p) => [p.date.slice(0, 10), p.value]));

  const minHeight = isCombo
    ? MIN_COMBO_HEIGHT
    : isRings
      ? MIN_RINGS_HEIGHT
      : isBmi
        ? MIN_BMI_HEIGHT
        : isHealthCalendar
          ? MIN_HEALTH_CALENDAR_HEIGHT
          : isMobile
            ? MOBILE_MIN_WIDGET_HEIGHT
            : MIN_WIDGET_HEIGHT;
  const minWidth = isRings
    ? MIN_RINGS_WIDTH
    : isBmi
      ? MIN_BMI_WIDTH
      : isHealthCalendar
        ? MIN_HEALTH_CALENDAR_WIDTH
        : isMobile
          ? MOBILE_MIN_WIDGET_WIDTH
          : MIN_WIDGET_WIDTH;
  const defaultWidth = isHealthCalendar
    ? DEFAULT_HEALTH_CALENDAR_WIDTH
    : isMobile
      ? MOBILE_DEFAULT_WIDGET_WIDTH
      : DEFAULT_WIDGET_WIDTH;
  const defaultHeight = isHealthCalendar
    ? DEFAULT_HEALTH_CALENDAR_HEIGHT
    : isMobile
      ? MOBILE_DEFAULT_WIDGET_HEIGHT
      : DEFAULT_WIDGET_HEIGHT;
  // A widget already sized for desktop shows visually compressed on mobile
  // (the saved width/height itself is untouched) - combo/rings/calendar are
  // exempt since they need more room than the cap to render their sub-content.
  const capWidth = isMobile && !isRings && !isHealthCalendar ? MOBILE_CAP_WIDTH : Infinity;
  const capHeight = isMobile && !isCombo && !isRings && !isHealthCalendar ? MOBILE_CAP_HEIGHT : Infinity;

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

  // Drag handle and controls stay hidden until the widget is hovered
  // (desktop) or tapped (touch, where hover doesn't apply) — tapping
  // outside deselects again.
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

  const positionStyle = {
    position: "absolute" as const,
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
  };

  const contentHeight = Math.max(24, rect.height - HEADER_HEIGHT - CONTENT_PADDING);
  const ringSize = Math.max(60, Math.min(rect.width, contentHeight) - 20);

  return (
    <>
      <div
        ref={widgetRef}
        style={positionStyle}
        className={styles.widget}
        data-selected={selected || undefined}
        onPointerDownCapture={() => setSelected(true)}
      >
        <div className={styles.header}>
          <div
            className={styles.dragHandle}
            onPointerDown={handleDragPointerDown}
            role="button"
            tabIndex={0}
            aria-label="Drag to move"
          >
            ⠿
          </div>
          <span className={styles.label}>{widget.label}</span>
          <div className={styles.controls}>
            <input
              type="color"
              className={styles.colorInput}
              value={widget.color ?? DEFAULT_WIDGET_COLOR}
              onChange={(e) => onColorChange(e.target.value)}
              aria-label="Widget color"
            />
            {!isCombo && !isRings && !isBmi && !isHealthCalendar && (
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
            <button type="button" className={styles.iconButton} onClick={onRemove} aria-label="Remove widget">
              ×
            </button>
          </div>
        </div>

        <div
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
          ) : !metric || metric.series.length === 0 ? (
            <p className={styles.empty}>No data yet for this metric.</p>
          ) : widget.viewType === "stat" ? (
            <DashboardStatTile
              value={formatValue(metric.series[metric.series.length - 1].value, metric.unit)}
              label={formatDate(metric.series[metric.series.length - 1].date)}
              valueColor={effectiveColor}
            />
          ) : widget.viewType === "ring" ? (
            <RingGauge
              percent={ringPercent(metric, metric.series[metric.series.length - 1].value)}
              color={ringColor(metric, metric.series[metric.series.length - 1].value, effectiveColor)}
              centerValue={formatValue(metric.series[metric.series.length - 1].value, metric.unit)}
              label={formatDate(metric.series[metric.series.length - 1].date)}
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

  const ringSize = Math.max(
    60,
    Math.min((measuredWidth - RINGS_ROW_GAP * 2) / 3, contentHeight - RING_LABEL_OVERHEAD),
  );

  return (
    <div className={styles.ringsRow} ref={containerRef}>
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
