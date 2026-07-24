import { useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { formatDate } from "../../utils/formatDate";
import { recoveryColor } from "../../utils/recoveryColor";
import StatTile from "../shared/StatTile";
import TrendChart from "../recovery/TrendChart";
import RingGauge from "./RingGauge";
import type { MetricDef } from "./useDashboardData";
import {
  WHOOP_STRAIN_RECOVERY_COMBO_ID,
  DEFAULT_WIDGET_WIDTH,
  DEFAULT_WIDGET_HEIGHT,
  MIN_WIDGET_WIDTH,
  MIN_WIDGET_HEIGHT,
  type Widget,
} from "./types";
import styles from "./DashboardWidget.module.css";

interface DashboardWidgetProps {
  widget: Widget;
  metricById: Map<string, MetricDef>;
  onViewTypeChange: (viewType: Widget["viewType"]) => void;
  onResize: (width: number, height: number) => void;
  onRemove: () => void;
}

const HEADER_HEIGHT = 44;
const CONTENT_PADDING = 32;
const MIN_COMBO_HEIGHT = 320;

function formatValue(value: number, unit: string): string {
  const rounded = Number.isInteger(value) ? value : Math.round(value * 10) / 10;
  return unit ? `${rounded.toLocaleString()} ${unit}` : rounded.toLocaleString();
}

function ringColor(metric: MetricDef, value: number): string {
  if (metric.id === "whoop.recovery") return recoveryColor(value);
  if (metric.id === "whoop.sleepPerformance") return "#8FA9C5";
  if (metric.id === "whoop.strain") return "#4B87F5";
  return "var(--color-accent-2)";
}

function ringPercent(metric: MetricDef, value: number): number {
  if (metric.unit === "%") return value;
  if (metric.id === "whoop.strain") return (value / 21) * 100;
  return Math.min(100, value);
}

export default function DashboardWidget({ widget, metricById, onViewTypeChange, onResize, onRemove }: DashboardWidgetProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: widget.id });
  const isCombo = widget.metric === WHOOP_STRAIN_RECOVERY_COMBO_ID;
  const metric = isCombo ? undefined : metricById.get(widget.metric);

  const minHeight = isCombo ? MIN_COMBO_HEIGHT : MIN_WIDGET_HEIGHT;

  const [size, setSize] = useState({
    width: widget.width ?? DEFAULT_WIDGET_WIDTH,
    height: Math.max(minHeight, widget.height ?? DEFAULT_WIDGET_HEIGHT),
  });
  const resizeStart = useRef<{ pointerX: number; pointerY: number; width: number; height: number } | null>(null);
  const liveSize = useRef(size);

  const handleResizePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    resizeStart.current = { pointerX: e.clientX, pointerY: e.clientY, width: size.width, height: size.height };
  };

  const handleResizePointerMove = (e: React.PointerEvent) => {
    if (!resizeStart.current) return;
    const dx = e.clientX - resizeStart.current.pointerX;
    const dy = e.clientY - resizeStart.current.pointerY;
    const next = {
      width: Math.max(MIN_WIDGET_WIDTH, resizeStart.current.width + dx),
      height: Math.max(minHeight, resizeStart.current.height + dy),
    };
    liveSize.current = next;
    setSize(next);
  };

  const handleResizePointerUp = () => {
    if (!resizeStart.current) return;
    resizeStart.current = null;
    onResize(Math.round(liveSize.current.width), Math.round(liveSize.current.height));
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
    <div ref={setNodeRef} style={dragStyle} className={styles.widget}>
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
            chartHeight={Math.max(24, contentHeight / 2 - 24)}
          />
        ) : !metric || metric.series.length === 0 ? (
          <p className={styles.empty}>No data yet for this metric.</p>
        ) : widget.viewType === "stat" ? (
          <StatTile
            value={formatValue(metric.series[metric.series.length - 1].value, metric.unit)}
            label={formatDate(metric.series[metric.series.length - 1].date)}
          />
        ) : widget.viewType === "ring" ? (
          <RingGauge
            percent={ringPercent(metric, metric.series[metric.series.length - 1].value)}
            color={ringColor(metric, metric.series[metric.series.length - 1].value)}
            centerValue={formatValue(metric.series[metric.series.length - 1].value, metric.unit)}
            label={formatDate(metric.series[metric.series.length - 1].date)}
            pixelSize={ringSize}
          />
        ) : widget.viewType === "chart" ? (
          metric.series.length > 1 ? (
            <TrendChart points={metric.series} height={contentHeight} />
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
                  <span>{formatValue(point.value, metric.unit)}</span>
                </li>
              ))}
          </ul>
        )}
      </div>

      <div
        className={styles.resizeHandle}
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerUp}
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
}: {
  strain: MetricDef | undefined;
  recovery: MetricDef | undefined;
  chartHeight: number;
}) {
  if (!strain?.series.length || !recovery?.series.length) {
    return <p className={styles.empty}>No data yet for this metric.</p>;
  }

  const strainWeek = strain.series.slice(-COMBO_DAYS);
  const recoveryWeek = recovery.series.slice(-COMBO_DAYS);

  return (
    <div className={styles.combo}>
      <div>
        <span className={styles.comboLabel}>Strain</span>
        {strainWeek.length > 1 ? (
          <TrendChart
            points={strainWeek}
            pointColor={() => "#4B87F5"}
            pointLabel={(p) => p.value.toFixed(1)}
            showDates
            height={chartHeight}
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
