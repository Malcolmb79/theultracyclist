import { useEffect, useState } from "react";
import { irelandTodayDateStr } from "../../utils/irelandDate";
import styles from "./TrainingCalendarCard.module.css";

type PlannedWorkout = {
  id: string;
  date: string;
  sport: "Bike" | "Run" | "Strength" | "Other";
  title: string;
  durationMinutes?: number;
  tssPlanned?: number;
};

const WINDOW_DAYS_PAST = 7;
const WINDOW_DAYS_FUTURE = 21;
const shortDateFormatter = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });

function addDays(date: string, n: number): string {
  // Plain "YYYY-MM-DD" arithmetic anchored to the Irish calendar day, rather
  // than shifting a Date and serialising it - mixing local getters with a UTC
  // toISOString() is how a window ends up a day out either side of midnight.
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// This card is a viewer, not a builder - creating/editing structured
// workouts happens by describing them to the AI Coach card (chat or
// WhatsApp), which has tools to build the interval structure and auto-
// compute duration/TSS/IF itself. Keeping workout creation conversational
// (matching how tp-mcp's own users create workouts) avoids needing a whole
// separate interval-builder form UI here.
export default function TrainingCalendarCard() {
  const [workouts, setWorkouts] = useState<PlannedWorkout[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const today = irelandTodayDateStr();
    const from = addDays(today, -WINDOW_DAYS_PAST);
    const to = addDays(today, WINDOW_DAYS_FUTURE);

    fetch(`/api/planned-workouts?from=${from}&to=${to}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("failed"))))
      .then((body: { workouts: PlannedWorkout[] }) => {
        if (!cancelled) setWorkouts(body.workouts ?? []);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleDelete = (id: string) => {
    setWorkouts((prev) => prev?.filter((w) => w.id !== id) ?? prev);
    fetch(`/api/planned-workouts?id=${id}`, { method: "DELETE" }).catch(() => {});
  };

  const todayStr = irelandTodayDateStr();
  const sorted = workouts
    ? [...workouts].sort((a, b) => a.date.localeCompare(b.date))
    : null;
  const upcoming = sorted?.filter((w) => w.date.slice(0, 10) >= todayStr) ?? [];
  const past = sorted?.filter((w) => w.date.slice(0, 10) < todayStr).slice(-3) ?? [];

  return (
    <div className={styles.card}>
      <span className={styles.eyebrow}>Training Calendar</span>

      {workouts === null && !error && <p className={styles.empty}>Loading…</p>}
      {error && <p className={styles.empty}>Couldn't load planned workouts.</p>}
      {workouts != null && workouts.length === 0 && (
        <p className={styles.empty}>
          Nothing scheduled - ask the coach to build you a session, e.g. "give me 4x8min threshold for Tuesday".
        </p>
      )}

      {workouts != null && workouts.length > 0 && (
        <ul className={styles.list}>
          {[...past, ...upcoming].map((w) => (
            <li key={w.id} className={styles.row}>
              <div className={styles.rowMain}>
                <span className={styles.rowDate}>{shortDateFormatter.format(new Date(w.date))}</span>
                <span className={styles.rowTitle}>{w.title}</span>
                <span className={styles.rowMeta}>
                  {w.sport}
                  {w.durationMinutes != null ? ` · ${w.durationMinutes}min` : ""}
                  {w.tssPlanned != null ? ` · ${w.tssPlanned} TSS` : ""}
                </span>
              </div>
              <button type="button" className={styles.removeButton} onClick={() => handleDelete(w.id)} aria-label={`Remove ${w.title}`}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
