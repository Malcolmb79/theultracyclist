import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./WhoopDetailModal.module.css";
import { formatMinutes, qualityBand } from "./detailFormat";

type GoodDirection = "up" | "down" | "neutral";

export function ComparisonRow({
  label,
  value,
  avgValue,
  unit,
  minutesFormat,
  decimals = 0,
  goodDirection,
}: {
  label: string;
  value: number;
  avgValue: number | null;
  unit?: string;
  minutesFormat?: boolean;
  decimals?: number;
  goodDirection: GoodDirection;
}) {
  const round = (v: number) => (decimals > 0 ? v.toFixed(decimals) : `${Math.round(v * 10) / 10}`);
  const formatted = minutesFormat ? formatMinutes(value) : `${decimals > 0 ? value.toFixed(decimals) : value}${unit ?? ""}`;
  const formattedAvg = avgValue != null ? (minutesFormat ? formatMinutes(avgValue) : `${round(avgValue)}${unit ?? ""}`) : null;

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

export function BandRow({ label, percent, color }: { label: string; percent: number; color?: string }) {
  return (
    <li className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowValues}>
        <span className={styles.bandTrack}>
          <span
            className={styles.bandFill}
            style={{ width: `${Math.max(0, Math.min(100, percent))}%`, background: color ?? qualityBand(percent).color }}
          />
        </span>
        <span className={styles.rowValue}>{Math.round(percent)}%</span>
      </span>
    </li>
  );
}

export function TextRow({ label, value }: { label: string; value: string }) {
  return (
    <li className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowValues}>
        <span className={styles.rowValue}>{value}</span>
      </span>
    </li>
  );
}

export function DetailModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
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

  return createPortal(
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>{title}</span>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className={styles.content}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}

