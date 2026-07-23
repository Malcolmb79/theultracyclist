import styles from "./StravaSummary.module.css";

type PeriodSummary = {
  rideCount: number;
  distanceKm: number;
  movingTimeMinutes: number;
  elevationGainM: number;
  avgWatts: number | null;
  avgHeartrate: number | null;
  totalRelativeEffort: number | null;
};

interface StravaSummaryProps {
  weekly: PeriodSummary;
  monthly: PeriodSummary;
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

function summaryLine(period: PeriodSummary): string {
  const parts = [
    `${period.rideCount} ${period.rideCount === 1 ? "ride" : "rides"}`,
    `${period.distanceKm} km`,
    formatDuration(period.movingTimeMinutes),
    `${period.elevationGainM} m climbed`,
  ];
  if (period.avgWatts) parts.push(`${period.avgWatts} W avg`);
  if (period.avgHeartrate) parts.push(`${period.avgHeartrate} bpm avg`);
  if (period.totalRelativeEffort) parts.push(`${period.totalRelativeEffort} total effort`);
  return parts.join(" · ");
}

export default function StravaSummary({ weekly, monthly }: StravaSummaryProps) {
  if (weekly.rideCount === 0 && monthly.rideCount === 0) {
    return null;
  }

  return (
    <div className={styles.grid}>
      <div className={styles.card}>
        <span className={styles.label}>Last 7 days</span>
        <span className={styles.line}>{summaryLine(weekly)}</span>
      </div>
      <div className={styles.card}>
        <span className={styles.label}>Last 30 days</span>
        <span className={styles.line}>{summaryLine(monthly)}</span>
      </div>
    </div>
  );
}
