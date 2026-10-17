import { useEffect, useState } from "react";
import { formatDate } from "../../utils/formatDate";
import { readinessColor } from "../../utils/garmin";
import StatTile from "../shared/StatTile";
import TrendChart from "./TrendChart";
import styles from "./RecoverySummary.module.css";

type Summary = {
  today: string;
  readiness: { score: number; level: string; date: string } | null;
  sleep: { score: number; hours: number | null; date: string } | null;
  bodyBattery: { level: number; at: string | null; atWake: number | null; date: string } | null;
  /** Newest first. */
  history: { date: string; readiness: number | null; sleepScore: number | null; bodyBatteryAtWake: number | null }[];
};

type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; summary: Summary };

function Trend({ current, previous }: { current: number; previous?: number | null }) {
  if (previous == null || current === previous) {
    return <span className={styles.trendFlat}>–</span>;
  }
  return <span className={styles.trend}>{current > previous ? "▲" : "▼"}</span>;
}

function dayStats(day: Summary["history"][number]): string[] {
  const stats: string[] = [];
  if (day.readiness != null) stats.push(`readiness ${day.readiness}`);
  if (day.sleepScore != null) stats.push(`sleep ${day.sleepScore}`);
  if (day.bodyBatteryAtWake != null) stats.push(`woke at ${day.bodyBatteryAtWake} battery`);
  return stats;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

function trendPoints(history: Summary["history"], pick: (day: Summary["history"][number]) => number | null) {
  return history
    .slice()
    .reverse()
    .map((day) => ({ date: day.date, value: pick(day) }))
    .filter((p): p is { date: string; value: number } => p.value != null);
}

/** The public Follow page's recovery section, from Garmin. */
export default function GarminSummary() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/garmin-summary")
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        return res.json() as Promise<Summary>;
      })
      .then((summary) => {
        if (!cancelled) setState({ status: "ready", summary });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") return <p className={styles.placeholder}>Loading recovery data…</p>;
  const summary = state.status === "ready" ? state.summary : null;
  if (!summary || (!summary.readiness && !summary.sleep && !summary.bodyBattery)) {
    return <p className={styles.placeholder}>Recovery data isn't available right now.</p>;
  }

  const { readiness, sleep, bodyBattery, history } = summary;
  const week = history.slice(0, 7);
  const previous = (pick: (d: Summary["history"][number]) => number | null, date: string | undefined) => {
    const index = history.findIndex((d) => d.date === date);
    return index >= 0 ? pick(history[index + 1] ?? { date: "", readiness: null, sleepScore: null, bodyBatteryAtWake: null }) : null;
  };
  const tracked = history.filter((d) => d.readiness != null || d.sleepScore != null).length;
  const avgReadiness = average(history.map((d) => d.readiness).filter((v): v is number => v != null));
  const avgSleep = average(history.map((d) => d.sleepScore).filter((v): v is number => v != null));
  const readinessTrend = trendPoints(history, (d) => d.readiness);
  const sleepTrend = trendPoints(history, (d) => d.sleepScore);

  return (
    <>
      <p className={styles.today}>{formatDate(summary.today)}</p>
      <div className={styles.grid}>
        {readiness && (
          <StatTile
            value={
              <>
                <span style={{ color: readinessColor(readiness.score) }}>{readiness.score}</span>{" "}
                <Trend current={readiness.score} previous={previous((d) => d.readiness, readiness.date)} />
              </>
            }
            subValue={`${readiness.level}${readiness.date !== summary.today ? ` · ${formatDate(readiness.date)}` : ""}`}
            label="Training Readiness"
          />
        )}
        {sleep && (
          <StatTile
            value={
              <>
                {sleep.score} <Trend current={sleep.score} previous={previous((d) => d.sleepScore, sleep.date)} />
              </>
            }
            subValue={sleep.hours != null ? `${sleep.hours}h asleep` : undefined}
            label="Sleep score"
          />
        )}
        {bodyBattery && (
          <StatTile
            value={<>{bodyBattery.level}</>}
            subValue={[
              bodyBattery.at && bodyBattery.date === summary.today ? `at ${bodyBattery.at}` : formatDate(bodyBattery.date),
              bodyBattery.atWake != null ? `woke at ${bodyBattery.atWake}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
            label="Body Battery"
          />
        )}
      </div>

      {week.length > 0 && (
        <ul className={styles.week}>
          {week.map((day) => (
            <li key={day.date} className={styles.day}>
              <span className={styles.dayDate}>{formatDate(day.date)}</span>
              <span className={styles.dayStats}>{dayStats(day).join(" · ")}</span>
            </li>
          ))}
        </ul>
      )}

      {tracked > 0 && (
        <div className={styles.month}>
          <p className={styles.monthLabel}>
            Last {history.length} days · {tracked} {tracked === 1 ? "day" : "days"} tracked
            {avgReadiness != null && ` · ${avgReadiness} avg readiness`}
            {avgSleep != null && ` · ${avgSleep} avg sleep score`}
          </p>
          <div className={styles.trendGrid}>
            {readinessTrend.length > 1 && (
              <div className={styles.trendCard}>
                <span className={styles.trendCardLabel}>Training Readiness</span>
                <TrendChart points={readinessTrend} />
              </div>
            )}
            {sleepTrend.length > 1 && (
              <div className={styles.trendCard}>
                <span className={styles.trendCardLabel}>Sleep score</span>
                <TrendChart points={sleepTrend} />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
