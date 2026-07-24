import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { formatDate } from "../../utils/formatDate";
import { recoveryColor } from "../../utils/recoveryColor";
import StatTile from "../shared/StatTile";
import TrendChart from "../recovery/TrendChart";
import RingGauge from "./RingGauge";
import type { MetricDef } from "./useDashboardData";
import { WHOOP_STRAIN_RECOVERY_COMBO_ID, type Widget } from "./types";
import styles from "./DashboardWidget.module.css";

interface DashboardWidgetProps {
  widget: Widget;
  metricById: Map<string, MetricDef>;
  onViewTypeChange: (viewType: Widget["viewType"]) => void;
  onRemove: () => void;
}

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

export default function DashboardWidget({ widget, metricById, onViewTypeChange, onRemove }: DashboardWidgetProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: widget.id });
  const isCombo = widget.metric === WHOOP_STRAIN_RECOVERY_COMBO_ID;
  const metric = isCombo ? undefined : metricById.get(widget.metric);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className={styles.widget}>
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

      {isCombo ? (
        <ComboStrainRecovery strain={metricById.get("whoop.strain")} recovery={metricById.get("whoop.recovery")} />
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
        />
      ) : widget.viewType === "chart" ? (
        metric.series.length > 1 ? (
          <TrendChart points={metric.series} />
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
  );
}

function ComboStrainRecovery({ strain, recovery }: { strain: MetricDef | undefined; recovery: MetricDef | undefined }) {
  if (!strain?.series.length || !recovery?.series.length) {
    return <p className={styles.empty}>No data yet for this metric.</p>;
  }

  return (
    <div className={styles.combo}>
      <div>
        <span className={styles.comboLabel}>Strain</span>
        {strain.series.length > 1 ? (
          <TrendChart points={strain.series} />
        ) : (
          <p className={styles.empty}>Not enough data yet.</p>
        )}
      </div>
      <div>
        <span className={styles.comboLabel}>Recovery</span>
        {recovery.series.length > 1 ? (
          <TrendChart points={recovery.series} pointColor={(p) => recoveryColor(p.value)} />
        ) : (
          <p className={styles.empty}>Not enough data yet.</p>
        )}
      </div>
    </div>
  );
}
