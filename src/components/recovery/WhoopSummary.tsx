import { useEffect, useState } from "react";
import StatTile from "../shared/StatTile";
import styles from "./WhoopSummary.module.css";

type Recovery = { score: number; hrvMs: number; restingHeartRate: number };
type Strain = { score: number; avgHeartRate: number; maxHeartRate: number };
type Sleep = { performancePercent: number; totalSleepHours: number; lightHours: number; deepHours: number; remHours: number };

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; recovery: Recovery | null; strain: Strain | null; sleep: Sleep | null };

export default function WhoopSummary() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    fetch("/api/whoop-data")
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        return res.json() as Promise<{ recovery: Recovery | null; strain: Strain | null; sleep: Sleep | null }>;
      })
      .then((data) => {
        if (!cancelled) {
          setState({ status: "ready", recovery: data.recovery, strain: data.strain, sleep: data.sleep });
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

  const { recovery, strain, sleep } = state;

  return (
    <div className={styles.grid}>
      {recovery && <StatTile value={`${recovery.score}%`} label="Recovery" />}
      {recovery && <StatTile value={`${recovery.hrvMs} ms`} label="HRV" />}
      {recovery && <StatTile value={`${recovery.restingHeartRate} bpm`} label="Resting heart rate" />}
      {strain && <StatTile value={strain.score.toFixed(1)} label="Strain" />}
      {strain && <StatTile value={`${strain.avgHeartRate} bpm`} label="Avg heart rate" />}
      {sleep && (
        <StatTile
          value={`${sleep.performancePercent}%`}
          subValue={`${sleep.totalSleepHours}h total`}
          label="Sleep performance"
        />
      )}
    </div>
  );
}
