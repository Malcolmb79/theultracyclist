import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { formatDate } from "../../utils/formatDate";
import StatTile from "../shared/StatTile";
import TrendChart from "../recovery/TrendChart";
import type { MetricDef } from "./useDashboardData";
import type { Widget } from "./types";
import styles from "./DashboardWidget.module.css";

interface DashboardWidgetProps {
  widget: Widget;
  metric: MetricDef | undefined;
  onViewTypeChange: (viewType: Widget["viewType"]) => void;
  onRemove: () => void;
}

function formatValue(value: number, unit: string): string {
  const rounded = Number.isInteger(value) ? value : Math.round(value * 10) / 10;
  return unit ? `${rounded.toLocaleString()} ${unit}` : rounded.toLocaleString();
}

export default function DashboardWidget({ widget, metric, onViewTypeChange, onRemove }: DashboardWidgetProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: widget.id });

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
          <select
            className={styles.select}
            value={widget.viewType}
            onChange={(e) => onViewTypeChange(e.target.value as Widget["viewType"])}
          >
            <option value="stat">Stat</option>
            <option value="chart">Chart</option>
            <option value="timeline">Timeline</option>
          </select>
          <button type="button" className={styles.iconButton} onClick={onRemove} aria-label="Remove widget">
            ×
          </button>
        </div>
      </div>

      {!metric || metric.series.length === 0 ? (
        <p className={styles.empty}>No data yet for this metric.</p>
      ) : widget.viewType === "stat" ? (
        <StatTile
          value={formatValue(metric.series[metric.series.length - 1].value, metric.unit)}
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
