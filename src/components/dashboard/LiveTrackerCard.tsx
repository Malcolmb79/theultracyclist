import { useEffect, useState } from "react";
import styles from "./LiveTrackerCard.module.css";

// Matches the Edge's own flush cadence. Connect IQ will not fire the
// background temporal event that ships samples more often than every 5
// minutes, so polling faster than this only re-fetches a row that cannot
// have changed - it would burn requests to redraw the same numbers.
const POLL_INTERVAL_MS = 5 * 60_000;

// Mirrors the parts of api/live.json.ts this card reads - duplicated per
// this project's api/src decoupling convention, same as LiveTrackerMap.
type LiveJson = {
  status: string;
  live: {
    stale: boolean;
    age_s: number | null;
    speed_mps: number | null;
    power_30s_w: number | null;
    power_np_w: number | null;
    hr_bpm: number | null;
    hr_5min_bpm: number | null;
    cad_rpm: number | null;
    alt_m: number | null;
    batt_pct: number | null;
  };
  progress: { distance_m: number | null; elapsed_s: number | null; timer_s: number | null };
};

function clock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 3600)}:${String(Math.floor((total % 3600) / 60)).padStart(2, "0")}`;
}

// The readings arrive in 5-minute batches, so second-level precision here
// would be false precision.
function age(seconds: number): string {
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

/**
 * Live ride telemetry from the Edge 1040, on the private dashboard.
 *
 * Reads /api/live.json - the same endpoint the public /live page uses, and
 * the one that already computes the rolling windows (30-second power,
 * normalised power, five-minute heart rate) server-side so every viewer sees
 * the same numbers rather than each browser deriving its own.
 *
 * Every field here is one the Connect IQ app actually measures. A reading
 * that isn't there shows a dash rather than a plausible-looking substitute -
 * an unpaired power meter reads "—", not zero.
 */
export default function LiveTrackerCard() {
  const [data, setData] = useState<LiveJson | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/live.json")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Request failed"))))
        .then((body: LiveJson) => {
          if (cancelled) return;
          setData(body);
          setFailed(false);
        })
        .catch(() => {
          // Keep whatever is on screen rather than blanking it - the last
          // known numbers stay useful, and the caption already says how old
          // they are.
          if (!cancelled) setFailed(true);
        });
    };
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!data) {
    return <p className={styles.empty}>{failed ? "Tracker feed unavailable." : "Loading…"}</p>;
  }

  const { live, progress } = data;
  const noFeed = live.age_s == null;

  const rows: { label: string; value: string | null }[] = [
    { label: "Heart rate", value: live.hr_bpm == null ? null : `${live.hr_bpm} bpm` },
    { label: "HR (5 min)", value: live.hr_5min_bpm == null ? null : `${live.hr_5min_bpm} bpm` },
    { label: "Power (30s)", value: live.power_30s_w == null ? null : `${live.power_30s_w} W` },
    { label: "Normalised power", value: live.power_np_w == null ? null : `${live.power_np_w} W` },
    { label: "Cadence", value: live.cad_rpm == null ? null : `${live.cad_rpm} rpm` },
    { label: "Speed", value: live.speed_mps == null ? null : `${(live.speed_mps * 3.6).toFixed(1)} km/h` },
    { label: "Altitude", value: live.alt_m == null ? null : `${Math.round(live.alt_m)} m` },
    { label: "Distance", value: progress.distance_m == null ? null : `${(progress.distance_m / 1000).toFixed(1)} km` },
    { label: "Elapsed", value: progress.elapsed_s == null ? null : clock(progress.elapsed_s) },
    { label: "Moving", value: progress.timer_s == null ? null : clock(progress.timer_s) },
    { label: "Edge battery", value: live.batt_pct == null ? null : `${live.batt_pct}%` },
  ];

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        {/* Absent rather than greyed when nothing is arriving - a permanent
            badge that only changes colour still reads as live at a glance. */}
        {!noFeed && !live.stale && (
          <span className={styles.liveBadge}>
            <span className={styles.liveDot} />
            Live
          </span>
        )}
        <span className={styles.age}>
          {noFeed ? "Tracker hasn't sent yet" : live.stale ? "Last known" : age(live.age_s as number)}
        </span>
      </div>

      <div className={styles.rows}>
        {rows.map((row) => (
          <div key={row.label} className={styles.row}>
            <span className={styles.label}>{row.label}</span>
            <span className={row.value == null ? styles.missing : styles.value}>{row.value ?? "—"}</span>
          </div>
        ))}
      </div>

      {/* The 5-minute floor is a platform limit, not a fault, so the card
          says so rather than leaving it to be read as lag. */}
      <p className={styles.note}>Edge sends every 5 min</p>
    </div>
  );
}
