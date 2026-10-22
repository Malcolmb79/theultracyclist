import { useEffect, useState } from "react";
import { irelandTodayDateStr } from "../../utils/irelandDate";
import styles from "./SevenDayPlanCard.module.css";

/**
 * The TrainingPeaks plan for today and the six days after it - a rolling
 * week, so it never empties out on a Sunday the way a Monday-Sunday view does.
 *
 * A viewer only: the plan is changed in TrainingPeaks or by asking the coach.
 */

type TpWorkout = {
  id: string | null;
  date: string;
  title: string;
  sport: string | null;
  plannedTss: number | null;
  plannedMinutes: number | null;
  completed: boolean;
};

type TpResponse = {
  configured: boolean;
  authExpired?: boolean;
  workoutsUnavailable?: boolean;
  workouts: TpWorkout[];
};

type State = { status: "loading" } | { status: "error" } | { status: "ready"; data: TpResponse };

const DAYS = 7;

// TrainingPeaks workoutTypeValueId -> mark.
const SPORT_ICONS: Record<string, string> = {
  "1": "🏊", "2": "🚲", "3": "🏃", "4": "🔁", "5": "🤸", "6": "🏁", "7": "💤",
  "8": "🚵", "9": "🏋", "10": "•", "11": "⛷", "12": "🚣", "13": "🚶", "100": "•",
};

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dayLabel(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === addDays(today, 1)) return "Tomorrow";
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function formatDuration(minutes: number | null): string | null {
  if (minutes == null || minutes <= 0) return null;
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h${String(rest).padStart(2, "0")}`;
}

export default function SevenDayPlanCard() {
  const [state, setState] = useState<State>({ status: "loading" });
  const today = irelandTodayDateStr();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/trainingpeaks")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: TpResponse) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") return <p className={styles.note}>Loading the plan…</p>;
  if (state.status === "error") return <p className={styles.note}>Couldn&apos;t load TrainingPeaks.</p>;

  const { data } = state;
  if (!data.configured) return <p className={styles.note}>Connect TrainingPeaks in Settings to see the plan.</p>;
  if (data.authExpired) return <p className={styles.note}>The TrainingPeaks connection has expired - reconnect it in Settings.</p>;
  if (data.workoutsUnavailable) return <p className={styles.note}>TrainingPeaks workouts couldn&apos;t be read just now.</p>;

  const days = Array.from({ length: DAYS }, (_, i) => addDays(today, i));
  const inWindow = data.workouts.filter((w) => w.date >= today && w.date <= days[DAYS - 1]);
  const totalTss = inWindow.reduce((sum, w) => sum + (w.plannedTss ?? 0), 0);
  const totalMinutes = inWindow.reduce((sum, w) => sum + (w.plannedMinutes ?? 0), 0);

  return (
    <div className={styles.card}>
      <ul className={styles.days}>
        {days.map((date) => {
          const workouts = inWindow.filter((w) => w.date === date);
          return (
            <li key={date} className={`${styles.day} ${date === today ? styles.today : ""}`}>
              <span className={styles.dayLabel}>{dayLabel(date, today)}</span>
              {workouts.length === 0 ? (
                <span className={styles.rest}>Rest</span>
              ) : (
                <ul className={styles.list}>
                  {workouts.map((w, i) => (
                    <li key={w.id ?? `${date}-${i}`} className={`${styles.row} ${w.completed ? styles.done : ""}`}>
                      <span className={styles.icon} aria-hidden="true">
                        {w.completed ? "✓" : (w.sport && SPORT_ICONS[w.sport]) || "•"}
                      </span>
                      <span className={styles.name} title={w.title}>
                        {w.title}
                      </span>
                      <span className={styles.facts}>
                        {[formatDuration(w.plannedMinutes), w.plannedTss != null ? `${Math.round(w.plannedTss)} TSS` : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <p className={styles.total}>
        Next 7 days: {formatDuration(totalMinutes) ?? "0h"} · {Math.round(totalTss)} TSS planned
      </p>
    </div>
  );
}
