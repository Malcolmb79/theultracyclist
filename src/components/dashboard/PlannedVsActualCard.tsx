import { useEffect, useMemo, useState } from "react";
import { irelandTodayDateStr } from "../../utils/irelandDate";
import type { ResolvedRange } from "../../utils/dateRange";
import styles from "./PlannedVsActualCard.module.css";

/**
 * TrainingPeaks planned against done, over the widget's date range.
 *
 * Only days that have happened are compared. Today's sessions count once
 * they're done, not before, so the morning doesn't read as a missed day. What
 * is still planned inside the range is shown separately, rather than as a
 * shortfall.
 */

type TpWorkout = {
  id: string | null;
  date: string;
  plannedTss: number | null;
  plannedMinutes: number | null;
  actualTss?: number | null;
  actualMinutes?: number | null;
  completed: boolean;
};

type TpResponse = {
  configured: boolean;
  authExpired?: boolean;
  workoutsUnavailable?: boolean;
  workouts: TpWorkout[];
};

type State = { status: "loading" } | { status: "error" } | { status: "ready"; data: TpResponse };

type Measure = "tss" | "time";

type Bucket = { key: string; label: string; start: string; planned: number; actual: number; future: boolean };

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
}

function mondayOf(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((day + 6) % 7));
}

function formatHours(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return hours === 0 ? `${rest}min` : rest === 0 ? `${hours}h` : `${hours}h${String(rest).padStart(2, "0")}`;
}

const dayFormatter = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const monthFormatter = new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
const weekdayFormatter = new Intl.DateTimeFormat("en-GB", { weekday: "narrow", timeZone: "UTC" });

/** Days for up to a fortnight, weeks up to about four months, months beyond. */
function bucketing(range: ResolvedRange): "day" | "week" | "month" {
  const span = daysBetween(range.start, range.end);
  return span <= 14 ? "day" : span <= 120 ? "week" : "month";
}

function bucketStart(date: string, by: "day" | "week" | "month"): string {
  return by === "day" ? date : by === "week" ? mondayOf(date) : `${date.slice(0, 7)}-01`;
}

function bucketLabel(start: string, by: "day" | "week" | "month"): string {
  const d = new Date(`${start}T00:00:00Z`);
  return by === "day" ? weekdayFormatter.format(d) : by === "week" ? dayFormatter.format(d) : monthFormatter.format(d);
}

export default function PlannedVsActualCard({ range }: { range: ResolvedRange }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [measure, setMeasure] = useState<Measure>("tss");
  const today = irelandTodayDateStr();

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetch(`/api/trainingpeaks?from=${range.start}&to=${range.end}`)
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
  }, [range.start, range.end]);

  const summary = useMemo(() => {
    if (state.status !== "ready") return null;
    const workouts = state.data.workouts.filter((w) => w.date >= range.start && w.date <= range.end);
    // Past days, plus whatever of today is already done.
    const counted = (w: TpWorkout) => w.date < today || (w.date === today && w.completed);
    const plannedOf = (w: TpWorkout) => (measure === "tss" ? w.plannedTss : w.plannedMinutes) ?? 0;
    const actualOf = (w: TpWorkout) => (measure === "tss" ? w.actualTss : w.actualMinutes) ?? 0;

    const by = bucketing(range);
    const buckets = new Map<string, Bucket>();
    for (let date = bucketStart(range.start, by); date <= range.end; ) {
      buckets.set(date, { key: date, label: bucketLabel(date, by), start: date, planned: 0, actual: 0, future: date > today });
      date = by === "day" ? addDays(date, 1) : by === "week" ? addDays(date, 7) : `${addDays(`${date.slice(0, 7)}-28`, 4).slice(0, 7)}-01`;
    }
    for (const w of workouts) {
      const bucket = buckets.get(bucketStart(w.date, by));
      if (!bucket) continue;
      bucket.planned += plannedOf(w);
      bucket.actual += actualOf(w);
    }

    const past = workouts.filter(counted);
    const plannedSessions = past.filter((w) => (w.plannedTss ?? 0) > 0 || (w.plannedMinutes ?? 0) > 0);
    return {
      buckets: [...buckets.values()],
      planned: past.reduce((sum, w) => sum + plannedOf(w), 0),
      actual: past.reduce((sum, w) => sum + actualOf(w), 0),
      stillPlanned: workouts.filter((w) => !counted(w) && !w.completed).reduce((sum, w) => sum + plannedOf(w), 0),
      sessionsPlanned: plannedSessions.length,
      sessionsDone: plannedSessions.filter((w) => w.completed).length,
      unplanned: past.filter((w) => w.completed && !plannedSessions.includes(w)).length,
    };
  }, [state, range, measure, today]);

  if (state.status === "loading") return <p className={styles.note}>Loading the plan…</p>;
  if (state.status === "error") return <p className={styles.note}>Couldn&apos;t load TrainingPeaks.</p>;
  const { data } = state;
  if (!data.configured) return <p className={styles.note}>Connect TrainingPeaks in Settings to compare against the plan.</p>;
  if (data.authExpired) return <p className={styles.note}>The TrainingPeaks connection has expired - reconnect it in Settings.</p>;
  if (data.workoutsUnavailable || !summary) return <p className={styles.note}>TrainingPeaks workouts couldn&apos;t be read just now.</p>;

  const format = (value: number) => (measure === "tss" ? `${Math.round(value)}` : formatHours(value));
  const unit = measure === "tss" ? " TSS" : "";
  const percent = summary.planned > 0 ? Math.round((summary.actual / summary.planned) * 100) : null;
  const compliance = summary.sessionsPlanned > 0 ? Math.round((summary.sessionsDone / summary.sessionsPlanned) * 100) : null;
  const peak = Math.max(1, ...summary.buckets.map((b) => Math.max(b.planned, b.actual)));
  // Every label on a long range would collide, so only every nth is drawn.
  const labelEvery = Math.ceil(summary.buckets.length / 8);

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <div className={styles.headline}>
          <span className={styles.value}>
            {format(summary.actual)}
            <span className={styles.of}>
              {" "}
              / {format(summary.planned)}
              {unit}
            </span>
          </span>
          {percent != null && (
            <span className={`${styles.percent} ${percent >= 90 ? styles.good : percent >= 70 ? styles.fair : styles.low}`}>
              {percent}%
            </span>
          )}
        </div>
        <div className={styles.toggle} role="group" aria-label="Compare by">
          {(["tss", "time"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`${styles.toggleButton} ${measure === m ? styles.toggleActive : ""}`}
              onClick={() => setMeasure(m)}
            >
              {m === "tss" ? "TSS" : "Time"}
            </button>
          ))}
        </div>
      </div>

      <p className={styles.facts}>
        {compliance != null
          ? `${summary.sessionsDone} of ${summary.sessionsPlanned} planned sessions done (${compliance}%)`
          : "No sessions were planned in this range yet"}
        {summary.unplanned > 0 ? ` · ${summary.unplanned} unplanned` : ""}
        {summary.stillPlanned > 0 ? ` · ${format(summary.stillPlanned)}${unit} still to come` : ""}
      </p>

      <div className={styles.chart} role="img" aria-label="Planned and actual per period">
        {summary.buckets.map((b, i) => (
          <div
            key={b.key}
            className={styles.column}
            title={`${b.label}: ${format(b.actual)}${unit} done of ${format(b.planned)}${unit} planned`}
          >
            <div className={styles.bars}>
              <div
                className={`${styles.planned} ${b.future ? styles.future : ""}`}
                style={{ height: `${(b.planned / peak) * 100}%` }}
              />
              <div className={styles.actual} style={{ height: `${(b.actual / peak) * 100}%` }} />
            </div>
            <span className={styles.label}>{i % labelEvery === 0 ? b.label : ""}</span>
          </div>
        ))}
      </div>

      <div className={styles.legend}>
        <span>
          <i className={styles.keyPlanned} /> Planned
        </span>
        <span>
          <i className={styles.keyActual} /> Actual
        </span>
      </div>
    </div>
  );
}
