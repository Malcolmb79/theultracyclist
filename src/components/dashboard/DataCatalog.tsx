import type { MetricDef } from "./useDashboardData";
import styles from "./DataCatalog.module.css";

interface DataCatalogProps {
  metrics: MetricDef[];
  onAdd: (metric: MetricDef) => void;
}

const SOURCE_LABELS: Record<MetricDef["source"], string> = {
  strava: "Strava",
  whoop: "Whoop",
  health: "Apple Health",
};

export default function DataCatalog({ metrics, onAdd }: DataCatalogProps) {
  const grouped = (["strava", "whoop", "health"] as const).map((source) => ({
    source,
    items: metrics.filter((m) => m.source === source),
  }));

  return (
    <div className={styles.catalog}>
      <h2 className={styles.title}>Available data</h2>
      <p className={styles.hint}>
        Tap "+ Add" to place a widget on the dashboard, then drag or resize it wherever you like. You can add the same
        metric more than once (e.g. a stat and a trend chart side by side).
      </p>
      {grouped.map(
        ({ source, items }) =>
          items.length > 0 && (
            <div key={source} className={styles.group}>
              <h3 className={styles.groupLabel}>{SOURCE_LABELS[source]}</h3>
              <ul className={styles.list}>
                {items.map((metric) => (
                  <li key={metric.id} className={styles.item}>
                    <span className={styles.itemLabel}>{metric.label}</span>
                    <button type="button" className={styles.addButton} onClick={() => onAdd(metric)}>
                      + Add
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ),
      )}
    </div>
  );
}
