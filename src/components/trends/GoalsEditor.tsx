import { useEffect, useState } from "react";
import type { Goals } from "./types";
import { useUnits } from "../../context/UnitsContext";
import { convertValueUnit } from "../../utils/units";
import styles from "./GoalsEditor.module.css";

interface GoalsEditorProps {
  goals: Goals;
  onSave: (goals: Goals) => Promise<void>;
}

const FIELDS: { key: keyof Goals; label: string; unit: string }[] = [
  { key: "weightKg", label: "Weight target", unit: "kg" },
  { key: "sleepHours", label: "Sleep target", unit: "h" },
  { key: "proteinG", label: "Protein target", unit: "g" },
  { key: "fatG", label: "Fat target", unit: "g" },
  { key: "carbsG", label: "Carb target", unit: "g" },
  { key: "calorieGoalTrainingDay", label: "Calories - training day", unit: "kcal" },
  { key: "calorieGoalRestDay", label: "Calories - rest day", unit: "kcal" },
];

// Only the weight goal has an imperial/metric split; the rest (h, g, kcal)
// have no equivalent and are always stored/shown as-is.
const CONVERTIBLE_KEYS = new Set<keyof Goals>(["weightKg"]);

export default function GoalsEditor({ goals, onSave }: GoalsEditorProps) {
  const { system } = useUnits();
  const [draft, setDraft] = useState<Goals>(goals);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(goals), [goals]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.editor}>
      <h3 className={styles.title}>Goals</h3>
      <p className={styles.hint}>Training days are detected automatically from Strava rides and Whoop activity.</p>
      {FIELDS.map(({ key, label, unit }) => {
        const convertible = CONVERTIBLE_KEYS.has(key);
        const displayUnit = convertible ? convertValueUnit(1, unit, system).unit : unit;
        const stored = draft[key] as number | undefined;
        const displayValue =
          convertible && stored != null
            ? Math.round(convertValueUnit(stored, unit, system).value * 10) / 10
            : stored;

        const handleChange = (inputValue: string) => {
          if (inputValue === "") {
            setDraft((d) => ({ ...d, [key]: undefined }));
            return;
          }
          const entered = Number(inputValue);
          const nextStored = convertible ? convertValueUnit(entered, displayUnit, "metric").value : entered;
          setDraft((d) => ({ ...d, [key]: nextStored }));
        };

        return (
          <label key={key} className={styles.field}>
            <span className={styles.fieldLabel}>{label}</span>
            <div className={styles.inputRow}>
              <input
                type="number"
                className={styles.input}
                value={displayValue ?? ""}
                onChange={(e) => handleChange(e.target.value)}
              />
              <span className={styles.unit}>{displayUnit}</span>
            </div>
          </label>
        );
      })}
      <button type="button" className={styles.saveButton} onClick={handleSave} disabled={saving}>
        {saving ? "Saving…" : "Save goals"}
      </button>
    </div>
  );
}
