import { useDraggable } from "@dnd-kit/core";
import type { MetricDef } from "./useDashboardData";
import { CATALOG_DRAG_PREFIX } from "./types";
import styles from "./DataCatalog.module.css";

interface DataCatalogProps {
  metrics: MetricDef[];
  addedIds: Set<string>;
  onAdd: (metric: MetricDef) => void;
}

const SOURCE_LABELS: Record<MetricDef["source"], string> = {
  strava: "Strava",
  whoop: "Whoop",
  health: "Apple Health",
};

function CatalogItem({ metric, added, onAdd }: { metric: MetricDef; added: boolean; onAdd: (metric: MetricDef) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `${CATALOG_DRAG_PREFIX}${metric.id}`,
    disabled: added,
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: isDragging ? 20 : undefined, position: "relative" as const }
    : undefined;

  return (
    <li ref={setNodeRef} style={style} {...listeners} {...attributes} className={styles.item}>
      <span className={styles.itemLabel}>{metric.label}</span>
      <button type="button" className={styles.addButton} onClick={() => onAdd(metric)} disabled={added}>
        {added ? "Added" : "+ Add"}
      </button>
    </li>
  );
}

export default function DataCatalog({ metrics, addedIds, onAdd }: DataCatalogProps) {
  const grouped = (["strava", "whoop", "health"] as const).map((source) => ({
    source,
    items: metrics.filter((m) => m.source === source),
  }));

  return (
    <div className={styles.catalog}>
      <h2 className={styles.title}>Available data</h2>
      <p className={styles.hint}>Drag an item onto the dashboard, or tap "+ Add".</p>
      {grouped.map(
        ({ source, items }) =>
          items.length > 0 && (
            <div key={source} className={styles.group}>
              <h3 className={styles.groupLabel}>{SOURCE_LABELS[source]}</h3>
              <ul className={styles.list}>
                {items.map((metric) => (
                  <CatalogItem key={metric.id} metric={metric} added={addedIds.has(metric.id)} onAdd={onAdd} />
                ))}
              </ul>
            </div>
          ),
      )}
    </div>
  );
}
