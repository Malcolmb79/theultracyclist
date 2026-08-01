import { useMeasuredWidth } from "../../utils/useMeasuredWidth";
import { useMeasuredHeight } from "../../utils/useMeasuredHeight";
import type { PerformancePoint } from "../../utils/performanceSeries";
import styles from "./PerformanceChart.module.css";

const FALLBACK_WIDTH = 300;
const DEFAULT_PLOT_HEIGHT = 160;
// One legend row, used only until the real one is measured on mount.
const FALLBACK_LEGEND_HEIGHT = 26;
// The plot never shrinks below this, even if the legend wraps to several
// rows in a short widget - past this point the chart stops being readable
// and it's better to let the widget's own min-height do the work.
const MIN_PLOT_HEIGHT = 80;
const TOP_PAD = 10;
const BOTTOM_PAD = 24;
// Reserves room on the left for the CTL/ATL/TSB Y-axis, in the middle-right
// for their end-of-line value labels, and on the far right for the TSS/day
// axis (its own scale - daily TSS runs far higher than CTL/ATL/TSB, so it
// can't share their axis). The plot area sits between the left and the two
// right margins instead of spanning the full width.
const LEFT_PAD = 30;
const RIGHT_PAD = 24;
const RIGHT_AXIS_PAD = 26;
// Minimum vertical gap enforced between the three end-of-line labels so they
// don't overlap when two of CTL/ATL/TSB land close together.
const MIN_LABEL_GAP = 9;
const TSS_DOT_RADIUS = 1.5;

const CTL_COLOR = "var(--color-accent-2)"; // fitness - green, matches the "on track" goal color elsewhere
const ATL_COLOR = "var(--color-amber)"; // fatigue
const TSB_COLOR = "#4B87F5"; // form - matches the blue used for "burned" elsewhere
const TSS_COLOR = "#d6559e"; // daily training load - pink, matching the usual PMC convention

interface PerformanceChartProps {
  data: PerformancePoint[];
  // Total height available to the whole card (plot plus legend), not the
  // plot alone - the legend wraps to two or three rows at narrower widget
  // widths, so how much is left for the plot can only be known here, after
  // the legend has been measured.
  availableHeight?: number;
}

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function fmt(value: number | null): string {
  return value == null ? "—" : Math.round(value).toString();
}

// CTL ("fitness") is colored by band rather than a single fixed color, so
// the line itself shows where the athlete's fitness actually stands: red
// below 30 (low), amber from 30 to 60 (building), green at 60+ (strong).
function ctlColorFor(ctl: number): string {
  if (ctl < 30) return "var(--color-accent)";
  if (ctl < 60) return "var(--color-amber)";
  return "var(--color-accent-2)";
}

// Standard "nice round number" tick step so the Y-axis reads 0/10/20/... or
// 0/25/50/... instead of awkward values like 0/17/34/51 - picks whichever
// of 1/2/5 (times a power of 10) gives roughly `count` ticks across the range.
function niceTicks(min: number, max: number, count = 4): number[] {
  if (max <= min) return [min];
  const rawStep = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const residual = rawStep / magnitude;
  const niceResidual = residual >= 5 ? 10 : residual >= 2 ? 5 : residual >= 1 ? 2 : 1;
  const step = niceResidual * magnitude;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

// The season's Performance Management Chart (CTL fitness / ATL fatigue /
// TSB form, the standard Coggan trio) with the athlete's real ATP plan
// targets for CTL and TSB overlaid as dashed lines - one widget answers
// both "what's my current training load" (the classic PMC) and "am I on
// track for the season" (the plan comparison), rather than two separate
// charts competing for the same widget space.
export default function PerformanceChart({ data, availableHeight }: PerformanceChartProps) {
  const [containerRef, viewWidth] = useMeasuredWidth(FALLBACK_WIDTH);
  const [legendRef, legendHeight] = useMeasuredHeight(FALLBACK_LEGEND_HEIGHT);

  if (data.length < 2) {
    return (
      <div ref={containerRef} className={styles.wrap}>
        <p className={styles.empty}>Not enough ride history yet to compute fitness/fatigue/form.</p>
      </div>
    );
  }

  const plotHeight =
    availableHeight == null
      ? DEFAULT_PLOT_HEIGHT
      : Math.max(MIN_PLOT_HEIGHT, availableHeight - TOP_PAD - BOTTOM_PAD - legendHeight);
  const viewHeight = TOP_PAD + plotHeight + BOTTOM_PAD;

  const allValues = data.flatMap((p) => [p.ctl, p.atl, p.tsb, p.ctlTarget, p.tsbTarget].filter((v): v is number => v != null));
  // TSB straddles zero, so the shared scale always includes 0 even if every
  // point happens to be positive/negative - otherwise the zero baseline
  // reference line below would fall outside the plotted range.
  const min = Math.min(0, ...allValues);
  const max = Math.max(0, ...allValues);
  const range = max - min || 1;

  const plotWidth = Math.max(1, viewWidth - LEFT_PAD - RIGHT_PAD - RIGHT_AXIS_PAD);
  const plotRightEdge = LEFT_PAD + plotWidth;
  const toX = (i: number) => LEFT_PAD + (i / (data.length - 1)) * plotWidth;
  const toY = (value: number) => TOP_PAD + plotHeight - ((value - min) / range) * plotHeight;
  const zeroY = toY(0);
  const yTicks = niceTicks(min, max);

  // TSS/day gets its own right-side axis/scale - always floored at 0 (no
  // negative training load), unlike CTL/ATL/TSB's shared left axis.
  const tssMax = Math.max(0, ...data.map((p) => p.tss));
  const toYTss = (value: number) => TOP_PAD + plotHeight - (value / (tssMax || 1)) * plotHeight;
  const tssTicks = niceTicks(0, tssMax);

  // `only` splits the line into what happened and what is projected, so the
  // two can be drawn with different strokes. The boundary point belongs to
  // both, otherwise the solid line and the dashed one meet with a visible gap.
  const linePath = (pick: (p: PerformancePoint) => number | null, only?: "actual" | "projected"): string => {
    let path = "";
    let drawing = false;
    data.forEach((p, i) => {
      const projected = p.projected === true;
      const include =
        only == null ||
        (only === "actual" ? !projected : projected || data[i - 1]?.projected === false);
      const v = include ? pick(p) : null;
      if (v == null) {
        drawing = false;
        return;
      }
      path += `${drawing ? "L" : "M"}${toX(i).toFixed(1)},${toY(v).toFixed(1)} `;
      drawing = true;
    });
    return path.trim();
  };

  // Labels describe where the athlete actually is, not where the projection
  // ends - a forward range must not make today's CTL read as next month's.
  const actual = data.filter((p) => p.projected !== true);
  const latest = actual[actual.length - 1] ?? data[data.length - 1];
  const todayIndex = data.findIndex((p) => p.projected === true) - 1;
  const hasProjection = data.some((p) => p.projected === true);

  // End-of-line value labels for CTL/ATL/TSB, nudged apart vertically when
  // two of them land within MIN_LABEL_GAP of each other so the text doesn't
  // overlap (common when form/fatigue converge).
  const endLabels = (
    [
      { key: "ctl", value: latest.ctl, color: ctlColorFor(latest.ctl) },
      { key: "atl", value: latest.atl, color: ATL_COLOR },
      { key: "tsb", value: latest.tsb, color: TSB_COLOR },
    ] as const
  )
    .map((l) => ({ ...l, y: toY(l.value) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < endLabels.length; i++) {
    const prev = endLabels[i - 1];
    const cur = endLabels[i];
    if (cur.y - prev.y < MIN_LABEL_GAP) cur.y = prev.y + MIN_LABEL_GAP;
  }

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
        {yTicks.map((tick) => (
          <g key={tick}>
            <line x1={LEFT_PAD} y1={toY(tick)} x2={plotRightEdge} y2={toY(tick)} className={styles.gridLine} />
            <text x={LEFT_PAD - 4} y={toY(tick)} textAnchor="end" dominantBaseline="middle" className={styles.axisLabel}>
              {Math.round(tick)}
            </text>
          </g>
        ))}
        {tssTicks.map((tick) => (
          <text
            key={tick}
            x={viewWidth - 4}
            y={toYTss(tick)}
            textAnchor="end"
            dominantBaseline="middle"
            className={styles.axisLabel}
            style={{ fill: TSS_COLOR }}
          >
            {Math.round(tick)}
          </text>
        ))}
        <line x1={LEFT_PAD} y1={zeroY} x2={plotRightEdge} y2={zeroY} className={styles.zeroLine} />
        {data.map((p, i) => {
          if (i === 0) return null;
          // The solid CTL band stops at today; its projection is the dashed
          // line above.
          if (p.projected === true) return null;
          const prev = data[i - 1];
          const x1 = toX(i - 1);
          const x2 = toX(i);
          return (
            <polygon
              key={p.date}
              points={`${x1},${toY(prev.ctl)} ${x2},${toY(p.ctl)} ${x2},${zeroY} ${x1},${zeroY}`}
              fill={ctlColorFor(p.ctl)}
              fillOpacity={0.22}
            />
          );
        })}
        {data.map((p, i) =>
          p.tss > 0 ? (
            <circle key={p.date} cx={toX(i)} cy={toYTss(p.tss)} r={TSS_DOT_RADIUS} fill={TSS_COLOR} fillOpacity={0.7} />
          ) : null,
        )}
        <path d={linePath((p) => p.ctlTarget)} className={styles.targetLine} style={{ stroke: CTL_COLOR }} />
        <path d={linePath((p) => p.tsbTarget)} className={styles.targetLine} style={{ stroke: TSB_COLOR }} />
        <path d={linePath((p) => p.atl, "actual")} className={styles.line} style={{ stroke: ATL_COLOR }} />
        <path d={linePath((p) => p.tsb, "actual")} className={styles.line} style={{ stroke: TSB_COLOR }} />
        {/* Everything past today is arithmetic, not history - drawn faint and
            dashed so it can never be mistaken for a reading. */}
        {hasProjection && (
          <>
            <path d={linePath((p) => p.atl, "projected")} className={styles.projectedLine} style={{ stroke: ATL_COLOR }} />
            <path d={linePath((p) => p.tsb, "projected")} className={styles.projectedLine} style={{ stroke: TSB_COLOR }} />
            <path d={linePath((p) => p.ctl, "projected")} className={styles.projectedLine} style={{ stroke: CTL_COLOR }} />
            {todayIndex >= 0 && (
              <line
                x1={toX(todayIndex)}
                y1={TOP_PAD}
                x2={toX(todayIndex)}
                y2={TOP_PAD + plotHeight}
                className={styles.todayMarker}
              />
            )}
          </>
        )}
        {data.map((p, i) => {
          if (i === 0) return null;
          const prev = data[i - 1];
          return (
            <line
              key={p.date}
              x1={toX(i - 1)}
              y1={toY(prev.ctl)}
              x2={toX(i)}
              y2={toY(p.ctl)}
              className={styles.line}
              stroke={ctlColorFor(p.ctl)}
            />
          );
        })}
        {endLabels.map((l) => (
          <text
            key={l.key}
            x={plotRightEdge + 4}
            y={l.y}
            dominantBaseline="middle"
            className={styles.endLabel}
            style={{ fill: l.color }}
          >
            {fmt(l.value)}
          </text>
        ))}
        <text x={LEFT_PAD} y={viewHeight - 6} className={styles.dateLabel}>
          {shortDate(data[0].date)}
        </text>
        <text x={plotRightEdge} y={viewHeight - 6} textAnchor="end" className={styles.dateLabel}>
          {shortDate(latest.date)}
        </text>
      </svg>

      <div ref={legendRef} className={styles.legend}>
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
        <span className={styles.legendItem}>
          <i className={styles.swatch} style={{ background: TSS_COLOR }} /> TSS/day {fmt(latest.tss)}
        </span>
      </div>
    </div>
  );
}
