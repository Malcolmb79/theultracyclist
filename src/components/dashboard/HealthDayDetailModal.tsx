import { useEffect } from "react";
import { createPortal } from "react-dom";
import { recoveryColor } from "../../utils/recoveryColor";
import { bmiCategory, formatWeight } from "../../utils/bmi";
import { formatDate } from "../../utils/formatDate";
import styles from "./WhoopDetailModal.module.css";

// Deliberately its own local shape (not imported from useDashboardData.ts)
// so both Dashboard/Coaching's WhoopDay and Trends' own separately-fetched
// day shape can feed this modal without the two hooks needing to share a
// type - matching how the rest of this project keeps hooks decoupled.
export type HealthCalendarDay = {
  date: string;
  recovery: { score: number; hrvMs: number; restingHeartRate: number } | null;
  strain: { score: number; avgHeartRate: number; maxHeartRate: number; zone1to3Minutes: number; zone4to5Minutes: number } | null;
  sleep: {
    performancePercent: number;
    totalSleepHours: number;
    consistencyPercent: number;
    efficiencyPercent: number;
    hoursNeeded: number;
    respiratoryRate: number;
  } | null;
};

interface HealthDayDetailModalProps {
  date: string;
  day: HealthCalendarDay | undefined;
  weightVal: number | null;
  weightUnit: string;
  bmi: number | null;
  onClose: () => void;
}

function formatMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h}:${m.toString().padStart(2, "0")}`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <li className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowValues}>
        <span className={styles.rowValue}>{value}</span>
      </span>
    </li>
  );
}

function BandRow({ label, percent, color }: { label: string; percent: number; color: string }) {
  return (
    <li className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowValues}>
        <span className={styles.bandTrack}>
          <span className={styles.bandFill} style={{ width: `${Math.max(0, Math.min(100, percent))}%`, background: color }} />
        </span>
        <span className={styles.rowValue}>{Math.round(percent)}%</span>
      </span>
    </li>
  );
}

export default function HealthDayDetailModal({ date, day, weightVal, weightUnit, bmi, onClose }: HealthDayDetailModalProps) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  const hasAnything = !!day?.recovery || !!day?.strain || !!day?.sleep || weightVal != null;

  return createPortal(
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>{formatDate(date)}</span>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className={styles.content}>
          {!hasAnything ? (
            <p className={styles.empty}>No data for this day.</p>
          ) : (
            <ul className={styles.rows}>
              {day?.recovery && <BandRow label="Recovery" percent={day.recovery.score} color={recoveryColor(day.recovery.score)} />}
              {day?.recovery && <Row label="HRV" value={`${day.recovery.hrvMs} ms`} />}
              {day?.recovery && <Row label="Resting heart rate" value={`${day.recovery.restingHeartRate} bpm`} />}
              {day?.strain && <Row label="Strain" value={day.strain.score.toFixed(1)} />}
              {day?.strain && <Row label="Strain avg/max heart rate" value={`${day.strain.avgHeartRate} / ${day.strain.maxHeartRate} bpm`} />}
              {day?.strain && <Row label="Heart rate zones 1-3" value={formatMinutes(day.strain.zone1to3Minutes)} />}
              {day?.strain && <Row label="Heart rate zones 4-5" value={formatMinutes(day.strain.zone4to5Minutes)} />}
              {day?.sleep && <BandRow label="Sleep performance" percent={day.sleep.performancePercent} color="#8FA9C5" />}
              {day?.sleep && <Row label="Sleep duration" value={`${day.sleep.totalSleepHours.toFixed(1)} h (needed ${day.sleep.hoursNeeded.toFixed(1)} h)`} />}
              {day?.sleep && <Row label="Sleep consistency" value={`${day.sleep.consistencyPercent}%`} />}
              {day?.sleep && <Row label="Sleep efficiency" value={`${day.sleep.efficiencyPercent}%`} />}
              {day?.sleep && <Row label="Respiratory rate" value={`${day.sleep.respiratoryRate.toFixed(1)} rpm`} />}
              {weightVal != null && <Row label="Weight" value={`${formatWeight(weightVal)}${weightUnit}`} />}
              {bmi != null && <Row label="BMI" value={`${bmi.toFixed(1)} - ${bmiCategory(bmi).label}`} />}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
