import type { TrendMetricDef } from "./useTrendsData";
import type { Goals } from "./types";
import GoalsEditor from "./GoalsEditor";
import styles from "./TrendsCatalog.module.css";

interface TrendsCatalogProps {
  metrics: TrendMetricDef[];
  goals: Goals;
  onSaveGoals: (goals: Goals) => Promise<void>;
  onAdd: (metric: TrendMetricDef) => void;
}

const SOURCE_LABELS: Record<TrendMetricDef["source"], string> = {
  goal: "Goals vs Actual",
  whoop: "Whoop",
  strava: "Strava",
  health: "Apple Health",
};

const SOURCE_ORDER: TrendMetricDef["source"][] = ["goal", "whoop", "strava", "health"];

export default function TrendsCatalog({ metrics, goals, onSaveGoals, onAdd }: TrendsCatalogProps) {
  const grouped = SOURCE_ORDER.map((source) => ({ source, items: metrics.filter((m) => m.source === source) }));

  return (
    <div className={styles.catalog}>
      <h2 className={styles.title}>Available data</h2>
      <p className={styles.hint}>Tap "+ Add" to add a widget. The same metric can be added more than once.</p>
      <GoalsEditor goals={goals} onSave={onSaveGoals} />
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
