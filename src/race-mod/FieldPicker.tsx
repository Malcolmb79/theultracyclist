import { FIELD_GROUPS, RIDER_FIELDS } from "./riderFields";
import styles from "./FieldPicker.module.css";

// The rider fields to show, in groups like Sauce's own Nearby Athletes
// settings, as a block of the settings menu. The choice is kept as "a,b,c".

export default function FieldPicker({ title, value, onChange }: { title: string; value: string; onChange: (v: string) => void }) {
  const on = new Set(value.split(",").filter(Boolean));
  const toggle = (id: string) => {
    const next = new Set(on);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(RIDER_FIELDS.filter((f) => next.has(f.id)).map((f) => f.id).join(","));
  };
  return (
    <div className={styles.picker}>
      <div className={styles.title}>{title}</div>
      <div className={styles.groups}>
        {FIELD_GROUPS.map((g) => (
          <fieldset key={g} className={styles.group}>
            <legend>{g}</legend>
            {RIDER_FIELDS.filter((f) => f.group === g).map((f) => (
              <label key={f.id} className={styles.field}>
                <input type="checkbox" checked={on.has(f.id)} onChange={() => toggle(f.id)} />
                {f.label}
              </label>
            ))}
          </fieldset>
        ))}
      </div>
    </div>
  );
}
