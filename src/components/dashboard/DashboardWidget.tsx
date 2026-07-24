import { useEffect, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { formatDate } from "../../utils/formatDate";
import { recoveryColor } from "../../utils/recoveryColor";
import StatTile from "../shared/StatTile";
import TrendChart, { TREND_CHART_LABEL_TOP_PAD, TREND_CHART_LABEL_BOTTOM_PAD } from "../recovery/TrendChart";
import RingGauge from "./RingGauge";
import type { MetricDef } from "./useDashboardData";
import {
  WHOOP_STRAIN_RECOVERY_COMBO_ID,
  DEFAULT_WIDGET_WIDTH,
  DEFAULT_WIDGET_HEIGHT,
  DEFAULT_WIDGET_COLOR,
  MIN_WIDGET_WIDTH,
  MIN_WIDGET_HEIGHT,
  type Widget,
} from "./types";
import styles from "./DashboardWidget.module.css";

interface DashboardWidgetProps {
  widget: Widget;
  metricById: Map<string, MetricDef>;
  onViewTypeChange: (viewType: Widget["viewType"]) => void;
  onColorChange: (color: string) => void;
  onResize: (width: number, height: number) => void;
  onRemove: () => void;
}

const HEADER_HEIGHT = 44;
const CONTENT_PADDING = 32;
const MIN_COMBO_HEIGHT = 360;
// Per combo section overhead: comboLabel row (~20px) + TrendChart's own
// top/bottom padding for point labels and date labels (36px), times 2
// sections, plus the gap between them (var(--space-3), 16px).
const COMBO_SECTION_OVERHEAD = 2 * (20 + 36) + 16;

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

function combineRefs<T>(...refs: (((node: T) => void) | { current: T | null } | null | undefined)[]) {
  return (node: T) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as { current: T | null }).current = node;
    }
  };
}

export default function DashboardWidget({
  widget,
  metricById,
  onViewTypeChange,
  onColorChange,
  onResize,
  onRemove,
}: DashboardWidgetProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: widget.id });
  const isCombo = widget.metric === WHOOP_STRAIN_RECOVERY_COMBO_ID;
  const metric = isCombo ? undefined : metricById.get(widget.metric);

  const minHeight = isCombo ? MIN_COMBO_HEIGHT : MIN_WIDGET_HEIGHT;

  const [size, setSize] = useState({
    width: Math.max(MIN_WIDGET_WIDTH, widget.width ?? DEFAULT_WIDGET_WIDTH),
    height: Math.max(minHeight, widget.height ?? DEFAULT_WIDGET_HEIGHT),
  });
  const resizeStart = useRef<{ pointerX: number; pointerY: number; width: number; height: number } | null>(null);
  const liveSize = useRef(size);

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

  // Resize dragging is handled via window-level listeners (rather than
  // relying solely on the handle's own onPointerMove/onPointerUp + pointer
  // capture) plus a body scroll lock for the duration of the drag. On iOS
  // Safari, a vertical-heavy drag starting on a small element can still get
  // interpreted as a page-scroll gesture even with touch-action: none on
  // the handle itself; locking body scroll while the pointer is down
  // guarantees the page can't steal the gesture regardless of exactly
  // where the touch lands.
  const handleResizePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();

    resizeStart.current = { pointerX: e.clientX, pointerY: e.clientY, width: size.width, height: size.height };

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
        width: Math.max(MIN_WIDGET_WIDTH, resizeStart.current.width + dx),
        height: Math.max(minHeight, resizeStart.current.height + dy),
      };
      liveSize.current = next;
      setSize(next);
    };

    const finish = () => {
      resizeStart.current = null;
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

  const dragStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    width: size.width,
    height: size.height,
  };

  const contentHeight = Math.max(24, size.height - HEADER_HEIGHT - CONTENT_PADDING);
  const ringSize = Math.max(60, Math.min(size.width, contentHeight) - 20);

  return (
    <div
      ref={combineRefs(setNodeRef, widgetRef)}
      style={dragStyle}
      className={styles.widget}
      data-selected={selected || undefined}
      onPointerDownCapture={() => setSelected(true)}
    >
      <div className={styles.header}>
        <div
          className={styles.dragHandle}
          {...attributes}
          {...listeners}
          role="button"
          tabIndex={0}
          aria-label="Drag to reorder"
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
          {!isCombo && (
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

      <div className={styles.content}>
        {isCombo ? (
          <ComboStrainRecovery
            strain={metricById.get("whoop.strain")}
            recovery={metricById.get("whoop.recovery")}
            chartHeight={Math.max(24, (contentHeight - COMBO_SECTION_OVERHEAD) / 2)}
            strainColor={widget.color}
          />
        ) : !metric || metric.series.length === 0 ? (
          <p className={styles.empty}>No data yet for this metric.</p>
        ) : widget.viewType === "stat" ? (
          <StatTile
            value={formatValue(metric.series[metric.series.length - 1].value, metric.unit)}
            label={formatDate(metric.series[metric.series.length - 1].date)}
            valueColor={widget.color}
          />
        ) : widget.viewType === "ring" ? (
          <RingGauge
            percent={ringPercent(metric, metric.series[metric.series.length - 1].value)}
            color={ringColor(metric, metric.series[metric.series.length - 1].value, widget.color)}
            centerValue={formatValue(metric.series[metric.series.length - 1].value, metric.unit)}
            label={formatDate(metric.series[metric.series.length - 1].date)}
            pixelSize={ringSize}
          />
        ) : widget.viewType === "chart" ? (
          metric.series.length > 1 ? (
            <TrendChart
              points={metric.series}
              height={Math.max(24, contentHeight - TREND_CHART_LABEL_TOP_PAD - TREND_CHART_LABEL_BOTTOM_PAD)}
              color={widget.color}
              pointLabel={(p) => formatValue(p.value, metric.unit)}
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
                  <span style={widget.color ? { color: widget.color } : undefined}>
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
