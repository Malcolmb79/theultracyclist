import { useEffect, useState } from "react";
import { formatDate } from "../../utils/formatDate";
import StatTile from "../shared/StatTile";
import TrendChart from "./TrendChart";
import styles from "./WhoopSummary.module.css";

type Recovery = { score: number; hrvMs: number; restingHeartRate: number };
type Strain = { score: number; avgHeartRate: number; maxHeartRate: number };
type Sleep = { performancePercent: number; totalSleepHours: number; lightHours: number; deepHours: number; remHours: number };
type DaySummary = { date: string; recovery: Recovery | null; strain: Strain | null; sleep: Sleep | null };

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; recovery: Recovery | null; strain: Strain | null; sleep: Sleep | null; history: DaySummary[] };

function dayStats(day: DaySummary): string[] {
  const stats: string[] = [];
  if (day.recovery) stats.push(`${day.recovery.score}% recovery`);
  if (day.recovery) stats.push(`${day.recovery.hrvMs} ms HRV`);
  if (day.recovery) stats.push(`${day.recovery.restingHeartRate} bpm resting`);
  if (day.strain) stats.push(`${day.strain.score.toFixed(1)} strain`);
  if (day.sleep) stats.push(`${day.sleep.performancePercent}% sleep`);
  return stats;
}

// Whoop's own recovery banding: green 67-100, yellow 34-66, red 0-33.
function recoveryColor(score: number): string {
  if (score >= 67) return "var(--color-accent-2)";
  if (score >= 34) return "var(--color-amber)";
  return "var(--color-accent)";
}

function Trend({ current, previous }: { current: number; previous?: number | null }) {
  if (previous == null || current === previous) {
    return <span className={styles.trendFlat}>–</span>;
  }
  return <span className={styles.trend}>{current > previous ? "▲" : "▼"}</span>;
}

// Whoop doesn't expose the personalized strain target via its API — this is
// a rough estimate from their publicly stated recovery-band guidance, not an
// official Whoop number.
function estimatedStrainTarget(recoveryScore: number): { min: number; max: number; label: string } {
  if (recoveryScore >= 67) return { min: 14, max: 21, label: "push" };
  if (recoveryScore >= 34) return { min: 10, max: 14, label: "maintain" };
  return { min: 0, max: 10, label: "rest" };
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

function trendPoints(history: DaySummary[], pick: (day: DaySummary) => number | null | undefined) {
  return history
    .slice()
    .reverse()
    .map((day) => ({ date: day.date, value: pick(day) }))
    .filter((p): p is { date: string; value: number } => p.value != null);
}

export default function WhoopSummary() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    fetch("/api/whoop-data")
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        return res.json() as Promise<{
          recovery: Recovery | null;
          strain: Strain | null;
          sleep: Sleep | null;
          history: DaySummary[];
        }>;
      })
      .then((data) => {
        if (!cancelled) {
          setState({
            status: "ready",
            recovery: data.recovery,
            strain: data.strain,
            sleep: data.sleep,
            history: data.history ?? [],
          });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") {
    return <p className={styles.placeholder}>Loading recovery data…</p>;
  }

  if (state.status === "error" || (!state.recovery && !state.strain && !state.sleep)) {
    return <p className={styles.placeholder}>Recovery data isn't available right now.</p>;
  }

  const { recovery, strain, sleep, history } = state;
  const week = history.slice(0, 7);
  const previous = week[1];
  const today = week[0];
  const strainTarget = recovery ? estimatedStrainTarget(recovery.score) : null;

  const avgRecovery = average(history.map((d) => d.recovery?.score).filter((v): v is number => v != null));
  const avgStrain = average(history.map((d) => d.strain?.score).filter((v): v is number => v != null));
  const avgSleep = average(history.map((d) => d.sleep?.performancePercent).filter((v): v is number => v != null));
  const daysTracked = history.filter((d) => d.recovery || d.strain || d.sleep).length;

  const recoveryTrend = trendPoints(history, (d) => d.recovery?.score);
  const strainTrend = trendPoints(history, (d) => d.strain?.score);
  const sleepTrend = trendPoints(history, (d) => d.sleep?.performancePercent);

  return (
    <>
      {today && <p className={styles.today}>{formatDate(today.date)}</p>}
      <div className={styles.grid}>
        {recovery && (
          <StatTile
            value={
              <>
                <span style={{ color: recoveryColor(recovery.score) }}>{recovery.score}%</span>{" "}
                <Trend current={recovery.score} previous={previous?.recovery?.score} />
              </>
            }
            label="Recovery"
          />
        )}
        {recovery && (
          <StatTile
            value={
              <>
                {recovery.hrvMs} ms <Trend current={recovery.hrvMs} previous={previous?.recovery?.hrvMs} />
              </>
            }
            label="HRV"
          />
        )}
        {recovery && (
          <StatTile
            value={
              <>
                {recovery.restingHeartRate} bpm{" "}
                <Trend current={recovery.restingHeartRate} previous={previous?.recovery?.restingHeartRate} />
              </>
            }
            label="Resting heart rate"
          />
        )}
        {strain && (
          <StatTile
            value={
              <>
                {strain.score.toFixed(1)} <Trend current={strain.score} previous={previous?.strain?.score} />
              </>
            }
            subValue={
              strainTarget && (
                <>
                  Est. target {strainTarget.min}–{strainTarget.max} ({strainTarget.label})
                </>
              )
            }
            label="Strain"
          />
        )}
        {strain && (
          <StatTile
            value={
              <>
                {strain.avgHeartRate} bpm{" "}
                <Trend current={strain.avgHeartRate} previous={previous?.strain?.avgHeartRate} />
              </>
            }
            label="Avg heart rate"
          />
        )}
        {sleep && (
          <StatTile
            value={
              <>
                {sleep.performancePercent}%{" "}
                <Trend current={sleep.performancePercent} previous={previous?.sleep?.performancePercent} />
              </>
            }
            subValue={`${sleep.totalSleepHours}h total`}
            label="Sleep performance"
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

      {daysTracked > 0 && (
        <div className={styles.month}>
          <p className={styles.monthLabel}>
            Last 30 days · {daysTracked} {daysTracked === 1 ? "day" : "days"} tracked
            {avgRecovery != null && ` · ${avgRecovery}% avg recovery`}
            {avgStrain != null && ` · ${avgStrain} avg strain`}
            {avgSleep != null && ` · ${avgSleep}% avg sleep`}
          </p>
          <div className={styles.trendGrid}>
            {recoveryTrend.length > 1 && (
              <div className={styles.trendCard}>
                <span className={styles.trendCardLabel}>Recovery</span>
                <TrendChart points={recoveryTrend} />
              </div>
            )}
            {strainTrend.length > 1 && (
              <div className={styles.trendCard}>
                <span className={styles.trendCardLabel}>Strain</span>
                <TrendChart points={strainTrend} />
              </div>
            )}
            {sleepTrend.length > 1 && (
              <div className={styles.trendCard}>
                <span className={styles.trendCardLabel}>Sleep performance</span>
                <TrendChart points={sleepTrend} />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
