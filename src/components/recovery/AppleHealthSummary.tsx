import { useEffect, useState } from "react";
import { formatDate } from "../../utils/formatDate";
import StatTile from "../shared/StatTile";
import TrendChart from "./TrendChart";
import styles from "./WhoopSummary.module.css";

type HealthDay = { date: string; steps: number | null; vo2Max: number | null; weightKg: number | null };

type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; history: HealthDay[] };

function Trend({ current, previous }: { current: number; previous?: number | null }) {
  if (previous == null || current === previous) {
    return <span className={styles.trendFlat}>–</span>;
  }
  return <span className={styles.trend}>{current > previous ? "▲" : "▼"}</span>;
}

function trendPoints(history: HealthDay[], pick: (day: HealthDay) => number | null | undefined) {
  return history
    .slice()
    .reverse()
    .map((day) => ({ date: day.date, value: pick(day) }))
    .filter((p): p is { date: string; value: number } => p.value != null);
}

function trendStats(points: { value: number }[], format: (n: number) => string) {
  const values = points.map((p) => p.value);
  return {
    low: format(Math.min(...values)),
    high: format(Math.max(...values)),
    now: format(values[values.length - 1]),
  };
}

export default function AppleHealthSummary() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    fetch("/api/health-data")
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        return res.json() as Promise<{ history: HealthDay[] }>;
      })
      .then((data) => {
        if (!cancelled) setState({ status: "ready", history: data.history ?? [] });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") {
    return <p className={styles.placeholder}>Loading Apple Health data…</p>;
  }

  if (state.status === "error" || state.history.length === 0) {
    return <p className={styles.placeholder}>Apple Health data isn't available yet.</p>;
  }

  const { history } = state;
  const latest = history[0];
  const previous = history[1];

  const stepsTrend = trendPoints(history, (d) => d.steps);
  const vo2Trend = trendPoints(history, (d) => d.vo2Max);
  const weightTrend = trendPoints(history, (d) => d.weightKg);

  return (
    <>
      <p className={styles.today}>{formatDate(latest.date)}</p>
      <div className={styles.grid}>
        {latest.steps != null && (
          <StatTile
            value={
              <>
                {latest.steps.toLocaleString()} <Trend current={latest.steps} previous={previous?.steps} />
              </>
            }
            label="Steps"
          />
        )}
        {latest.vo2Max != null && (
          <StatTile
            value={
              <>
                {latest.vo2Max} <Trend current={latest.vo2Max} previous={previous?.vo2Max} />
              </>
            }
            label="VO2 max"
          />
        )}
        {latest.weightKg != null && (
          <StatTile
            value={
              <>
                {latest.weightKg} kg <Trend current={latest.weightKg} previous={previous?.weightKg} />
              </>
            }
            label="Weight"
          />
        )}
      </div>

      {(stepsTrend.length > 1 || vo2Trend.length > 1 || weightTrend.length > 1) && (
        <div className={styles.month}>
          <div className={styles.trendGrid}>
            {stepsTrend.length > 1 && (
              <div className={styles.trendCard}>
                <span className={styles.trendCardLabel}>Steps</span>
                <TrendChart points={stepsTrend} />
                {(() => {
                  const s = trendStats(stepsTrend, (n) => Math.round(n).toLocaleString());
                  return (
                    <span className={styles.trendCardStats}>
                      Low {s.low} · High {s.high} · Now {s.now}
                    </span>
                  );
                })()}
              </div>
            )}
            {vo2Trend.length > 1 && (
              <div className={styles.trendCard}>
                <span className={styles.trendCardLabel}>VO2 max</span>
                <TrendChart points={vo2Trend} />
                {(() => {
                  const s = trendStats(vo2Trend, (n) => n.toFixed(1));
                  return (
                    <span className={styles.trendCardStats}>
                      Low {s.low} · High {s.high} · Now {s.now}
                    </span>
                  );
                })()}
              </div>
            )}
            {weightTrend.length > 1 && (
              <div className={styles.trendCard}>
                <span className={styles.trendCardLabel}>Weight</span>
                <TrendChart points={weightTrend} />
                {(() => {
                  const s = trendStats(weightTrend, (n) => `${n.toFixed(1)} kg`);
                  return (
                    <span className={styles.trendCardStats}>
                      Low {s.low} · High {s.high} · Now {s.now}
                    </span>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
