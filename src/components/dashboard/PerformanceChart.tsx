import { useMeasuredWidth } from "../../utils/useMeasuredWidth";
import type { PerformancePoint } from "../../utils/performanceSeries";
import styles from "./PerformanceChart.module.css";

const FALLBACK_WIDTH = 300;
const DEFAULT_PLOT_HEIGHT = 160;
const TOP_PAD = 10;
const BOTTOM_PAD = 24;

const CTL_COLOR = "var(--color-accent-2)"; // fitness - green, matches the "on track" goal color elsewhere
const ATL_COLOR = "var(--color-amber)"; // fatigue
const TSB_COLOR = "#4B87F5"; // form - matches the blue used for "burned" elsewhere

interface PerformanceChartProps {
  data: PerformancePoint[];
  height?: number;
}

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function fmt(value: number | null): string {
  return value == null ? "—" : Math.round(value).toString();
}

// The season's Performance Management Chart (CTL fitness / ATL fatigue /
// TSB form, the standard Coggan trio) with the athlete's real ATP plan
// targets for CTL and TSB overlaid as dashed lines - one widget answers
// both "what's my current training load" (the classic PMC) and "am I on
// track for the season" (the plan comparison), rather than two separate
// charts competing for the same widget space.
export default function PerformanceChart({ data, height }: PerformanceChartProps) {
  const [containerRef, viewWidth] = useMeasuredWidth(FALLBACK_WIDTH);

  if (data.length < 2) {
    return (
      <div ref={containerRef} className={styles.wrap}>
        <p className={styles.empty}>Not enough ride history yet to compute fitness/fatigue/form.</p>
      </div>
    );
  }

  const plotHeight = height ?? DEFAULT_PLOT_HEIGHT;
  const viewHeight = TOP_PAD + plotHeight + BOTTOM_PAD;

  const allValues = data.flatMap((p) => [p.ctl, p.atl, p.tsb, p.ctlTarget, p.tsbTarget].filter((v): v is number => v != null));
  // TSB straddles zero, so the shared scale always includes 0 even if every
  // point happens to be positive/negative - otherwise the zero baseline
  // reference line below would fall outside the plotted range.
  const min = Math.min(0, ...allValues);
  const max = Math.max(0, ...allValues);
  const range = max - min || 1;

  const toX = (i: number) => (i / (data.length - 1)) * viewWidth;
  const toY = (value: number) => TOP_PAD + plotHeight - ((value - min) / range) * plotHeight;
  const zeroY = toY(0);

  const linePath = (pick: (p: PerformancePoint) => number | null): string => {
    let path = "";
    let drawing = false;
    data.forEach((p, i) => {
      const v = pick(p);
      if (v == null) {
        drawing = false;
        return;
      }
      path += `${drawing ? "L" : "M"}${toX(i).toFixed(1)},${toY(v).toFixed(1)} `;
      drawing = true;
    });
    return path.trim();
  };

  const latest = data[data.length - 1];

  return (
    <div ref={containerRef} className={styles.wrap}>
      <svg
        width={viewWidth}
        height={viewHeight}
        viewBox={`0 0 ${viewWidth} ${viewHeight}`}
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        style={{ display: "block" }}
      >
        <line x1={0} y1={zeroY} x2={viewWidth} y2={zeroY} className={styles.zeroLine} />
        <path d={linePath((p) => p.ctlTarget)} className={styles.targetLine} style={{ stroke: CTL_COLOR }} />
        <path d={linePath((p) => p.tsbTarget)} className={styles.targetLine} style={{ stroke: TSB_COLOR }} />
        <path d={linePath((p) => p.atl)} className={styles.line} style={{ stroke: ATL_COLOR }} />
        <path d={linePath((p) => p.tsb)} className={styles.line} style={{ stroke: TSB_COLOR }} />
        <path d={linePath((p) => p.ctl)} className={styles.line} style={{ stroke: CTL_COLOR }} />
        <text x={4} y={viewHeight - 6} className={styles.dateLabel}>
          {shortDate(data[0].date)}
        </text>
        <text x={viewWidth - 4} y={viewHeight - 6} textAnchor="end" className={styles.dateLabel}>
          {shortDate(latest.date)}
        </text>
      </svg>

      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <i className={styles.swatch} style={{ background: CTL_COLOR }} /> CTL {fmt(latest.ctl)}
          {latest.ctlTarget != null && <span className={styles.target}> (target {fmt(latest.ctlTarget)})</span>}
        </span>
        <span className={styles.legendItem}>
          <i className={styles.swatch} style={{ background: ATL_COLOR }} /> ATL {fmt(latest.atl)}
        </span>
        <span className={styles.legendItem}>
          <i className={styles.swatch} style={{ background: TSB_COLOR }} /> TSB {fmt(latest.tsb)}
          {latest.tsbTarget != null && <span className={styles.target}> (target {fmt(latest.tsbTarget)})</span>}
        </span>
      </div>
    </div>
  );
}
