import { useEffect } from "react";
import { createPortal } from "react-dom";
import { bmiCategory, formatWeight } from "../../utils/bmi";
import { formatDate } from "../../utils/formatDate";
import { hrvStatusLabel, readinessColor, GARMIN_SLEEP_COLOR, type GarminDay } from "../../utils/garmin";
import styles from "./DetailModal.module.css";

interface HealthDayDetailModalProps {
  date: string;
  day: GarminDay | undefined;
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

  const hasAnything = !!day || weightVal != null;
  const g = day;
  const hrvStatus = hrvStatusLabel(g?.hrvStatus ?? null);

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
              {g?.readiness != null && <BandRow label="Training Readiness" percent={g.readiness} color={readinessColor(g.readiness)} />}
              {g?.hrv != null && <Row label="Overnight HRV" value={`${g.hrv} ms${hrvStatus ? ` (${hrvStatus})` : ""}`} />}
              {g?.restingHr != null && <Row label="Resting heart rate" value={`${g.restingHr} bpm`} />}
              {g?.trainingLoad != null && <Row label="Training load" value={`${Math.round(g.trainingLoad)}${g.acuteLoad != null ? ` (acute ${g.acuteLoad})` : ""}`} />}
              {g?.activityMinutes ? <Row label="Activity time" value={formatMinutes(g.activityMinutes)} /> : null}
              {g?.sleepScore != null && <BandRow label="Sleep score" percent={g.sleepScore} color={GARMIN_SLEEP_COLOR} />}
              {g?.sleepHours != null && <Row label="Sleep duration" value={`${g.sleepHours.toFixed(1)} h${g.sleepNeedHours != null ? ` (needed ${g.sleepNeedHours.toFixed(1)} h)` : ""}`} />}
              {g?.bodyBatteryWake != null && <Row label="Body Battery at wake" value={`${g.bodyBatteryWake}`} />}
              {g?.stress != null && <Row label="Average stress" value={`${g.stress}`} />}
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
