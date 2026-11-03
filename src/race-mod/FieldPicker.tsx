import { FIELD_GROUPS, RIDER_FIELDS, type FieldGroup, type RiderField } from "./riderFields";
import styles from "./FieldPicker.module.css";

// The rider fields to show, in groups like Sauce's own Nearby Athletes
// settings, as a block of the settings menu. The choice is kept as "a,b,c".
// Ordered, the choice keeps the order it's put in - new ones at the end -
// with the chosen ones listed above to move along or take out.

interface Props {
  title: string;
  value: string;
  onChange: (v: string) => void;
  fields?: RiderField[];
  groups?: FieldGroup[];
  ordered?: boolean;
}

export default function FieldPicker({ title, value, onChange, fields = RIDER_FIELDS, groups = FIELD_GROUPS, ordered = false }: Props) {
  const ids = value.split(",").filter((id) => fields.some((f) => f.id === id));
  const on = new Set(ids);
  const save = (next: string[]) => onChange(next.join(",") || "none");
  const toggle = (id: string) => {
    if (ordered) return save(on.has(id) ? ids.filter((x) => x !== id) : [...ids, id]);
    const next = new Set(on);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(fields.filter((f) => next.has(f.id)).map((f) => f.id).join(","));
  };
  const move = (i: number, by: number) => {
    const next = ids.slice();
    const j = i + by;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    save(next);
  };
  const byId = new Map(fields.map((f) => [f.id, f]));
  return (
    <div className={styles.picker}>
      <div className={styles.title}>{title}</div>
      {ordered && (
        <ol className={styles.order}>
          {ids.map((id, i) => (
            <li key={id} className={styles.chip}>
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move left">
                ◀
              </button>
              <span>{byId.get(id)?.label}</span>
              <button type="button" onClick={() => move(i, 1)} disabled={i === ids.length - 1} aria-label="Move right">
                ▶
              </button>
              <button type="button" onClick={() => toggle(id)} aria-label="Take out">
                ✕
              </button>
            </li>
          ))}
          {ids.length === 0 && <li className={styles.none}>Nothing chosen - tick some below</li>}
        </ol>
      )}
      <div className={styles.groups}>
        {groups.map((g) => (
          <fieldset key={g} className={styles.group}>
            <legend>{g}</legend>
            {fields.filter((f) => f.group === g).map((f) => (
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
