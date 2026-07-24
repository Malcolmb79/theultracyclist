import { useEffect, useState } from "react";
import { formatDate } from "../../utils/formatDate";
import StatTile from "../shared/StatTile";
import styles from "./WhoopSummary.module.css";

type MetricValue = { value: number; unit: string };
type DayMetrics = Record<string, MetricValue>;
type History = Record<string, DayMetrics>;

type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; history: History };

function formatMetricName(name: string): string {
  return name
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export default function AppleHealthSummary() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    fetch("/api/health-data")
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        return res.json() as Promise<{ history: History }>;
      })
      .then((data) => {
        if (!cancelled) setState({ status: "ready", history: data.history ?? {} });
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

  const dates = state.status === "ready" ? Object.keys(state.history).sort((a, b) => (a < b ? 1 : -1)) : [];

  if (state.status === "error" || dates.length === 0) {
    return <p className={styles.placeholder}>Apple Health data isn't available yet.</p>;
  }

  const latestDate = dates[0];
  const latestMetrics = state.history[latestDate];
  const entries = Object.entries(latestMetrics);

  return (
    <>
      <p className={styles.today}>{formatDate(latestDate)}</p>
      <div className={styles.grid}>
        {entries.map(([name, metric]) => (
          <StatTile
            key={name}
            value={`${metric.value.toLocaleString()} ${metric.unit}`}
            label={formatMetricName(name)}
          />
        ))}
      </div>
    </>
  );
}
