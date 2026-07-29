import { useMeasuredWidth } from "../../utils/useMeasuredWidth";
import { useMeasuredHeight } from "../../utils/useMeasuredHeight";
import { MACRO_COLORS, MACRO_LABELS, macroShares, totalKcal, type MacroGrams } from "../../utils/macros";
import styles from "./MacroSplitCard.module.css";

const FALLBACK_WIDTH = 260;
const DEFAULT_SIZE = 150;
const MIN_SIZE = 96;
const MAX_SIZE = 220;
const FALLBACK_LEGEND_HEIGHT = 96;
// Ring thickness as a fraction of the radius - a donut rather than a full
// pie so the day's total energy has somewhere to live in the middle.
const RING_THICKNESS = 0.34;
// Angular gap between segments, in degrees, standing in for the 2px surface
// gap a stacked bar would use. Scaled by radius so it stays visually
// constant as the widget resizes.
const SEGMENT_GAP_PX = 2;
// Below this share a slice is too thin to hold its own label without the
// text spilling over its neighbours - the legend still carries the number.
const MIN_LABEL_PERCENT = 8;

function polar(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

// A donut segment as a single closed path: out along the start edge, round
// the outer arc, in along the end edge, back round the inner arc.
function arcPath(cx: number, cy: number, rOuter: number, rInner: number, startDeg: number, endDeg: number): string {
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  const [x1, y1] = polar(cx, cy, rOuter, startDeg);
  const [x2, y2] = polar(cx, cy, rOuter, endDeg);
  const [x3, y3] = polar(cx, cy, rInner, endDeg);
  const [x4, y4] = polar(cx, cy, rInner, startDeg);
  return [
    `M${x1.toFixed(2)},${y1.toFixed(2)}`,
    `A${rOuter.toFixed(2)},${rOuter.toFixed(2)} 0 ${largeArc} 1 ${x2.toFixed(2)},${y2.toFixed(2)}`,
    `L${x3.toFixed(2)},${y3.toFixed(2)}`,
    `A${rInner.toFixed(2)},${rInner.toFixed(2)} 0 ${largeArc} 0 ${x4.toFixed(2)},${y4.toFixed(2)}`,
    "Z",
  ].join(" ");
}

function fmtGrams(value: number): string {
  return `${Math.round(value)}g`;
}

function fmtPercent(value: number | null): string {
  return value == null ? "—" : `${Math.round(value)}%`;
}

interface MacroSplitCardProps {
  grams: MacroGrams;
  /** Daily targets from the athlete's goals; all three are needed for a goal column. */
  goals: MacroGrams;
  /** What the numbers cover, e.g. "Today" - shown under the legend. */
  periodLabel?: string;
  availableHeight?: number;
}

// The day's carbohydrate/fat/protein split as a share of energy, with each
// macro's own grams and - when all three targets are set - the split the
// athlete is aiming for beside it. Answers "was today's balance right",
// which the three separate "X vs goal" widgets can't: those each say
// whether one macro hit its number, never how the day divided up.
export default function MacroSplitCard({ grams, goals, periodLabel, availableHeight }: MacroSplitCardProps) {
  const [containerRef, measuredWidth] = useMeasuredWidth(FALLBACK_WIDTH);
  const [legendRef, legendHeight] = useMeasuredHeight(FALLBACK_LEGEND_HEIGHT);

  const shares = macroShares(grams, goals);
  const kcal = totalKcal(grams);
  const hasGoals = shares.some((s) => s.goalPercent != null);

  if (kcal <= 0) {
    return (
      <div ref={containerRef} className={styles.wrap}>
        <p className={styles.empty}>
          Nothing logged yet - needs carbohydrate, fat and protein entries from Apple Health.
        </p>
      </div>
    );
  }

  const roomForChart = availableHeight == null ? DEFAULT_SIZE : availableHeight - legendHeight;
  const size = Math.max(MIN_SIZE, Math.min(MAX_SIZE, measuredWidth, roomForChart));
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size / 2 - 1;
  const rInner = rOuter * (1 - RING_THICKNESS);
  // Half the gap is taken off each end of every segment, so the visible gap
  // between two neighbours is SEGMENT_GAP_PX regardless of their sizes.
  const gapDeg = (SEGMENT_GAP_PX / (2 * Math.PI * rOuter)) * 360;

  let cursor = 0;
  const segments = shares
    .filter((s) => (s.percent ?? 0) > 0)
    .map((s) => {
      const sweep = ((s.percent as number) / 100) * 360;
      const start = cursor;
      cursor += sweep;
      return { ...s, start, end: cursor, sweep };
    });

  return (
    <div ref={containerRef} className={styles.wrap}>
      <div className={styles.chartRow}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-label={`Macro split: ${shares.map((s) => `${MACRO_LABELS[s.key]} ${fmtPercent(s.percent)}`).join(", ")}`}
        >
          {segments.map((s) => {
            // A lone macro would otherwise draw a zero-length arc once the
            // gap is subtracted from both ends of a full circle.
            const full = s.sweep >= 359.9;
            const start = full ? s.start : s.start + gapDeg / 2;
            const end = full ? s.end - 0.01 : s.end - gapDeg / 2;
            return (
              <path key={s.key} d={arcPath(cx, cy, rOuter, rInner, start, end)} fill={MACRO_COLORS[s.key]}>
                <title>{`${MACRO_LABELS[s.key]}: ${s.grams != null ? fmtGrams(s.grams) : "—"} (${fmtPercent(s.percent)})`}</title>
              </path>
            );
          })}
          {segments
            .filter((s) => (s.percent as number) >= MIN_LABEL_PERCENT)
            .map((s) => {
              const [lx, ly] = polar(cx, cy, (rOuter + rInner) / 2, (s.start + s.end) / 2);
              return (
                <text key={`l-${s.key}`} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" className={styles.sliceLabel}>
                  {fmtPercent(s.percent)}
                </text>
              );
            })}
          <text x={cx} y={cy - 5} textAnchor="middle" dominantBaseline="middle" className={styles.centreValue}>
            {Math.round(kcal).toLocaleString("en-GB")}
          </text>
          <text x={cx} y={cy + 10} textAnchor="middle" dominantBaseline="middle" className={styles.centreLabel}>
            kcal
          </text>
        </svg>
      </div>

      <div ref={legendRef} className={styles.legend}>
        <div className={styles.legendHead}>
          <span />
          <span>Total</span>
          {hasGoals && <span>Goal</span>}
        </div>
        {shares.map((s) => (
          <div key={s.key} className={styles.legendRow}>
            <span className={styles.legendName}>
              <i className={styles.swatch} style={{ background: MACRO_COLORS[s.key] }} />
              {MACRO_LABELS[s.key]}
              {s.grams != null && <span className={styles.grams}> ({fmtGrams(s.grams)})</span>}
            </span>
            <span className={styles.total}>{fmtPercent(s.percent)}</span>
            {hasGoals && <span className={styles.goal}>{fmtPercent(s.goalPercent)}</span>}
          </div>
        ))}
        {periodLabel && <div className={styles.period}>{periodLabel}</div>}
      </div>
    </div>
  );
}
