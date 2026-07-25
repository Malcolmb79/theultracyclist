import { useEffect, useState } from "react";
import type { Goals } from "./types";
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

export default function GoalsEditor({ goals, onSave }: GoalsEditorProps) {
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
      {FIELDS.map(({ key, label, unit }) => (
        <label key={key} className={styles.field}>
          <span className={styles.fieldLabel}>{label}</span>
          <div className={styles.inputRow}>
            <input
              type="number"
              className={styles.input}
              value={draft[key] ?? ""}
              onChange={(e) =>
                setDraft((d) => ({ ...d, [key]: e.target.value === "" ? undefined : Number(e.target.value) }))
              }
            />
            <span className={styles.unit}>{unit}</span>
          </div>
        </label>
      ))}
      <button type="button" className={styles.saveButton} onClick={handleSave} disabled={saving}>
        {saving ? "Saving…" : "Save goals"}
      </button>
    </div>
  );
}
