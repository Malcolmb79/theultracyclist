import type { MetricDef } from "./useDashboardData";
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

export default function DataCatalog({ metrics, addedIds, onAdd }: DataCatalogProps) {
  const grouped = (["strava", "whoop", "health"] as const).map((source) => ({
    source,
    items: metrics.filter((m) => m.source === source),
  }));

  return (
    <div className={styles.catalog}>
      <h2 className={styles.title}>Available data</h2>
      {grouped.map(
        ({ source, items }) =>
          items.length > 0 && (
            <div key={source} className={styles.group}>
              <h3 className={styles.groupLabel}>{SOURCE_LABELS[source]}</h3>
              <ul className={styles.list}>
                {items.map((metric) => {
                  const added = addedIds.has(metric.id);
                  return (
                    <li key={metric.id} className={styles.item}>
                      <span className={styles.itemLabel}>{metric.label}</span>
                      <button
                        type="button"
                        className={styles.addButton}
                        onClick={() => onAdd(metric)}
                        disabled={added}
                      >
                        {added ? "Added" : "+ Add"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ),
      )}
    </div>
  );
}
