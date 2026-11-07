import styles from "./FieldPicker.module.css";

// Choosing what goes in each section of a bar, in order: the chosen ones as
// chips (moved along or taken out), and a list to add more from. Each
// section's choice is kept as "a,b,c".

export interface BarChoice {
  id: string;
  label: string;
  group: string;
}

interface Props {
  choices: BarChoice[];
  groups: string[];
  sections: { key: string; title: string; value: string }[];
  onChange: (key: string, value: string) => void;
}

export default function BarPicker({ choices, groups, sections, onChange }: Props) {
  const byId = new Map(choices.map((c) => [c.id, c]));
  return (
    <div className={styles.picker}>
      {sections.map((sec) => {
        const ids = sec.value.split(",").filter((id) => byId.has(id));
        const save = (next: string[]) => onChange(sec.key, next.join(","));
        const move = (i: number, by: number) => {
          const next = ids.slice();
          const j = i + by;
          if (j < 0 || j >= next.length) return;
          [next[i], next[j]] = [next[j], next[i]];
          save(next);
        };
        return (
          <div key={sec.key} className={styles.section}>
            <div className={styles.title}>{sec.title}</div>
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
                  <button type="button" onClick={() => save(ids.filter((x) => x !== id))} aria-label="Take out">
                    ✕
                  </button>
                </li>
              ))}
              <li>
                <select
                  className={styles.add}
                  value=""
                  aria-label={`Add to ${sec.title.toLowerCase()}`}
                  onChange={(e) => e.target.value && save([...ids, e.target.value])}
                >
                  <option value="">+ Add…</option>
                  {groups.map((g) => (
                    <optgroup key={g} label={g}>
                      {choices
                        .filter((c) => c.group === g && !ids.includes(c.id))
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              </li>
            </ol>
          </div>
        );
      })}
    </div>
  );
}
