import type { Workout } from "./useWorkout";
import styles from "./Workout.module.css";

// Which workout this is, when Sauce couldn't hear it from Zwift: today's
// planned workouts first, then the rider's others, from Zwift. Kept for
// the day once picked.

export default function WorkoutPicker({ w, compact = false }: { w: Workout; compact?: boolean }) {
  if (!w.choices.length) return compact ? null : <span className={styles.note}>Looking up your Zwift workouts…</span>;
  const planned = w.choices.filter((c) => c.scheduled);
  const others = w.choices.filter((c) => !c.scheduled);
  return (
    <label className={`${styles.picker} ${compact ? styles.pickerCompact : ""}`}>
      {!compact && <span className={styles.lbl}>{w.picked ? "Workout" : "Which workout is this?"}</span>}
      <select value={w.picked ?? ""} onChange={(e) => e.target.value && w.pick(e.target.value)}>
        {!w.picked && <option value="">Choose…</option>}
        {planned.length > 0 && (
          <optgroup label="Planned for today">
            {planned.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="Your workouts">
          {others.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </optgroup>
      </select>
    </label>
  );
}
