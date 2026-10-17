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

type TpWorkout = {
  date: string;
  title: string;
  sport: string | null;
  plannedTss: number | null;
  plannedMinutes: number | null;
  completed: boolean;
};

type TpState = { configured: boolean; authExpired?: boolean; workouts: TpWorkout[] } | null;

type Row = {
  key: string;
  date: string;
  title: string;
  sport: string | null;
  minutes: number | null;
  tss: number | null;
  source: "coach" | "trainingPeaks";
  completed: boolean;
  /** Only the coach's own workouts can be removed from here. */
  coachId?: string;
};

// TrainingPeaks workoutTypeValueId -> sport.
const TP_SPORTS: Record<string, string> = {
  "1": "Swim", "2": "Bike", "3": "Run", "4": "Brick", "5": "Cross-training", "6": "Race", "7": "Day off",
  "8": "MTB", "9": "Strength", "10": "Custom", "11": "XC ski", "12": "Rowing", "13": "Walk", "100": "Other",
};

const WINDOW_DAYS_PAST = 7;
const WINDOW_DAYS_FUTURE = 21;
const PAST_ROWS = 3;
const shortDateFormatter = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

function addDays(date: string, n: number): string {
  // Plain "YYYY-MM-DD" arithmetic anchored to the Irish calendar day, rather
  // than shifting a Date and serialising it - mixing local getters with a UTC
  // toISOString() is how a window ends up a day out either side of midnight.
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Shows the TrainingPeaks plan alongside the workouts the AI Coach has built.
// It is a viewer, not a builder: creating and editing structured workouts
// happens by describing them to the coach (chat or WhatsApp), and the
// TrainingPeaks plan is edited in TrainingPeaks.
export default function TrainingCalendarCard() {
  const [coach, setCoach] = useState<PlannedWorkout[] | null>(null);
  const [tp, setTp] = useState<TpState | undefined>(undefined);
  const [coachError, setCoachError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const today = irelandTodayDateStr();
    const from = addDays(today, -WINDOW_DAYS_PAST);
    const to = addDays(today, WINDOW_DAYS_FUTURE);

    fetch(`/api/planned-workouts?from=${from}&to=${to}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("failed"))))
      .then((body: { workouts: PlannedWorkout[] }) => {
        if (!cancelled) setCoach(body.workouts ?? []);
      })
      .catch(() => {
        if (!cancelled) {
          setCoachError(true);
          setCoach([]);
        }
      });

    fetch("/api/trainingpeaks")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: TpState) => {
        if (!cancelled) setTp(body);
      })
      .catch(() => {
        if (!cancelled) setTp(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleDelete = (id: string) => {
    setCoach((prev) => prev?.filter((w) => w.id !== id) ?? prev);
    fetch(`/api/planned-workouts?id=${id}`, { method: "DELETE" }).catch(() => {});
  };

  const todayStr = irelandTodayDateStr();
  const loading = coach === null || tp === undefined;
  const windowStart = addDays(todayStr, -WINDOW_DAYS_PAST);
  const windowEnd = addDays(todayStr, WINDOW_DAYS_FUTURE);

  const rows: Row[] = [
    ...(coach ?? []).map((w) => ({
      key: `coach-${w.id}`,
      date: w.date.slice(0, 10),
      title: w.title,
      sport: w.sport,
      minutes: w.durationMinutes ?? null,
      tss: w.tssPlanned ?? null,
      source: "coach" as const,
      completed: false,
      coachId: w.id,
    })),
    ...(tp?.workouts ?? [])
      .filter((w) => w.date >= windowStart && w.date <= windowEnd)
      .map((w, i) => ({
        key: `tp-${w.date}-${i}`,
        date: w.date,
        title: w.title,
        sport: w.sport ? (TP_SPORTS[w.sport] ?? null) : null,
        minutes: w.plannedMinutes,
        tss: w.plannedTss,
        source: "trainingPeaks" as const,
        completed: w.completed,
      })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const upcoming = rows.filter((r) => r.date >= todayStr);
  const past = rows.filter((r) => r.date < todayStr).slice(-PAST_ROWS);
  const tpNote = tp?.authExpired
    ? "TrainingPeaks needs reconnecting in Settings - showing the coach's workouts only."
    : tp && !tp.configured
      ? "Connect TrainingPeaks in Settings to see your plan here."
      : null;

  return (
    <div className={styles.card}>
      <span className={styles.eyebrow}>Training Calendar</span>

      {loading && <p className={styles.empty}>Loading…</p>}
      {!loading && tpNote && <p className={styles.empty}>{tpNote}</p>}
      {!loading && coachError && <p className={styles.empty}>Couldn't load the coach's workouts.</p>}
      {!loading && rows.length === 0 && (
        <p className={styles.empty}>
          Nothing scheduled - ask the coach to build you a session, e.g. "give me 4x8min threshold for Tuesday".
        </p>
      )}

      {!loading && rows.length > 0 && (
        <ul className={styles.list}>
          {[...past, ...upcoming].map((w) => (
            <li key={w.key} className={`${styles.row} ${w.date === todayStr ? styles.today : ""}`}>
              <div className={styles.rowMain}>
                <span className={styles.rowDate}>
                  {w.date === todayStr ? "Today" : shortDateFormatter.format(new Date(`${w.date}T12:00:00Z`))}
                  {w.completed ? " ✓" : ""}
                </span>
                <span className={styles.rowTitle}>{w.title}</span>
                <span className={styles.rowMeta}>
                  {[w.sport, w.minutes != null ? `${w.minutes}min` : null, w.tss != null ? `${w.tss} TSS` : null]
                    .filter(Boolean)
                    .join(" · ")}
                  <span className={styles.source}>{w.source === "trainingPeaks" ? "TrainingPeaks" : "Coach"}</span>
                </span>
              </div>
              {w.coachId && (
                <button type="button" className={styles.removeButton} onClick={() => handleDelete(w.coachId!)} aria-label={`Remove ${w.title}`}>
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
