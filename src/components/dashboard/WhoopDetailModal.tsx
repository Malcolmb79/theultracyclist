import { useEffect } from "react";
import { createPortal } from "react-dom";
import RingGauge from "./RingGauge";
import { recoveryColor } from "../../utils/recoveryColor";
import type { WhoopDay } from "./useDashboardData";
import styles from "./WhoopDetailModal.module.css";

export type WhoopDetailKind = "sleep" | "recovery" | "strain";

interface WhoopDetailModalProps {
  kind: WhoopDetailKind;
  history: WhoopDay[]; // chronological, oldest first
  onClose: () => void;
}

const KIND_LABEL: Record<WhoopDetailKind, string> = {
  sleep: "Sleep Performance",
  recovery: "Recovery",
  strain: "Strain",
};

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function formatMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h}:${m.toString().padStart(2, "0")}`;
}

function qualityBand(percent: number): { label: string; color: string } {
  if (percent >= 85) return { label: "Optimal", color: "var(--color-accent-2)" };
  if (percent >= 50) return { label: "Sufficient", color: "var(--color-text-muted)" };
  return { label: "Poor", color: "var(--color-amber)" };
}

type GoodDirection = "up" | "down" | "neutral";

function ComparisonRow({
  label,
  value,
  avgValue,
  unit,
  minutesFormat,
  goodDirection,
}: {
  label: string;
  value: number;
  avgValue: number | null;
  unit?: string;
  minutesFormat?: boolean;
  goodDirection: GoodDirection;
}) {
  const formatted = minutesFormat ? formatMinutes(value) : `${value}${unit ?? ""}`;
  const formattedAvg = avgValue != null ? (minutesFormat ? formatMinutes(avgValue) : `${Math.round(avgValue * 10) / 10}${unit ?? ""}`) : null;

  let arrow: string | null = null;
  let arrowColor = "var(--color-text-muted)";
  if (avgValue != null && Math.abs(value - avgValue) > 0.05) {
    const isUp = value > avgValue;
    arrow = isUp ? "▲" : "▼";
    if (goodDirection === "up") arrowColor = isUp ? "var(--color-accent-2)" : "var(--color-amber)";
    else if (goodDirection === "down") arrowColor = isUp ? "var(--color-amber)" : "var(--color-accent-2)";
  }

  return (
    <li className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowValues}>
        <span className={styles.rowValue}>{formatted}</span>
        {arrow && (
          <span className={styles.rowArrow} style={{ color: arrowColor }}>
            {arrow}
          </span>
        )}
        {formattedAvg && <span className={styles.rowAvg}>{formattedAvg}</span>}
      </span>
    </li>
  );
}

function BandRow({ label, percent }: { label: string; percent: number }) {
  const band = qualityBand(percent);
  return (
    <li className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowValues}>
        <span className={styles.bandTrack}>
          <span className={styles.bandFill} style={{ width: `${Math.max(0, Math.min(100, percent))}%`, background: band.color }} />
        </span>
        <span className={styles.rowValue}>{percent}%</span>
      </span>
    </li>
  );
}

export default function WhoopDetailModal({ kind, history, onClose }: WhoopDetailModalProps) {
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

  const daysWithData = history.filter((d) => d[kind] != null);
  const today = daysWithData[daysWithData.length - 1];
  const priorDays = daysWithData.slice(0, -1);

  const body = !today ? (
    <p className={styles.empty}>No data yet for this metric.</p>
  ) : kind === "sleep" ? (
    <>
      <RingGauge
        percent={today.sleep!.performancePercent}
        color="#8FA9C5"
        centerValue={`${today.sleep!.performancePercent}%`}
        label="SLEEP PERFORMANCE"
        pixelSize={200}
      />
      <ul className={styles.rows}>
        <BandRow
          label="Hours vs Needed"
          percent={today.sleep!.hoursNeeded > 0 ? Math.round((today.sleep!.totalSleepHours / today.sleep!.hoursNeeded) * 100) : 0}
        />
        <BandRow label="Sleep Consistency" percent={today.sleep!.consistencyPercent} />
        <BandRow label="Sleep Efficiency" percent={today.sleep!.efficiencyPercent} />
      </ul>
      <p className={styles.note}>
        Whoop's own "High Sleep Stress" figure isn't exposed by their public API, so it isn't shown here.
      </p>
    </>
  ) : kind === "recovery" ? (
    <>
      <RingGauge
        percent={today.recovery!.score}
        color={recoveryColor(today.recovery!.score)}
        centerValue={`${today.recovery!.score}%`}
        label="RECOVERY"
        pixelSize={200}
      />
      <ul className={styles.rows}>
        <ComparisonRow
          label="Heart Rate Variability"
          value={today.recovery!.hrvMs}
          avgValue={average(priorDays.map((d) => d.recovery?.hrvMs).filter((v): v is number => v != null))}
          unit=" ms"
          goodDirection="up"
        />
        <ComparisonRow
          label="Resting Heart Rate"
          value={today.recovery!.restingHeartRate}
          avgValue={average(priorDays.map((d) => d.recovery?.restingHeartRate).filter((v): v is number => v != null))}
          unit=" bpm"
          goodDirection="down"
        />
        {today.sleep && (
          <ComparisonRow
            label="Respiratory Rate"
            value={today.sleep.respiratoryRate}
            avgValue={average(priorDays.map((d) => d.sleep?.respiratoryRate).filter((v): v is number => v != null))}
            unit=" rpm"
            goodDirection="neutral"
          />
        )}
        {today.sleep && (
          <ComparisonRow
            label="Sleep Performance"
            value={today.sleep.performancePercent}
            avgValue={average(priorDays.map((d) => d.sleep?.performancePercent).filter((v): v is number => v != null))}
            unit="%"
            goodDirection="up"
          />
        )}
      </ul>
    </>
  ) : (
    <>
      <RingGauge
        percent={(today.strain!.score / 21) * 100}
        color="#4B87F5"
        centerValue={today.strain!.score.toFixed(1)}
        label="STRAIN"
        pixelSize={200}
      />
      <ul className={styles.rows}>
        <ComparisonRow
          label="Heart Rate Zones 1-3"
          value={today.strain!.zone1to3Minutes}
          avgValue={average(priorDays.map((d) => d.strain?.zone1to3Minutes).filter((v): v is number => v != null))}
          minutesFormat
          goodDirection="neutral"
        />
        <ComparisonRow
          label="Heart Rate Zones 4-5"
          value={today.strain!.zone4to5Minutes}
          avgValue={average(priorDays.map((d) => d.strain?.zone4to5Minutes).filter((v): v is number => v != null))}
          minutesFormat
          goodDirection="neutral"
        />
      </ul>
      <p className={styles.note}>
        Whoop's "Strength Activity Time" and "Steps" breakdown rows aren't exposed by their public API, so they aren't shown here.
      </p>
    </>
  );

  return createPortal(
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>{KIND_LABEL[kind]}</span>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className={styles.content}>{body}</div>
      </div>
    </div>,
    document.body,
  );
}
