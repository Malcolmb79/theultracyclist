import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { OverlayShell, useSettings, type SettingDef } from "./overlay";
import { useSauce } from "./useSauce";
import { stepAt, stepName, targetAt, type Step } from "./workoutPlan";
import { EXAMPLE_AT, EXAMPLE_FILE, clock } from "./workoutExample";
import { useWorkout } from "./useWorkout";
import WorkoutPicker from "./WorkoutPicker";
import { POWER_ZONES, zoneColor } from "./zones";
import shell from "./Overlay.module.css";
import styles from "./Workout.module.css";

// The Zwift workout being ridden, along the bottom of the screen the way
// TrainingPeaks draws a planned workout: every block by its target (in the
// zone colours), the rider's power traced over what's done and a cursor
// where they are - with the target and their power now, a countdown into
// each change, a gauge of how close they are, and a scorecard as each
// interval ends.
//
// It comes from Zwift itself: the workout file and the progress through it
// reach Sauce over its Game Connection (getWorkoutStatus).

const DEFAULTS = {
  opacity: 80,
  example: false,
  trace: true,
  smoothing: 3,
  tolerance: 0.05,
  countdown: 10,
  beep: false,
  scorecard: true,
  gauge: true,
  hideWhenNone: false,
  debug: false,
};
const DEFS: SettingDef[] = [
  { key: "example", label: "Show an example (for placing it)", type: "toggle" },
  { key: "trace", label: "My power over the blocks", type: "toggle" },
  { key: "gauge", label: "On-target gauge", type: "toggle" },
  {
    key: "smoothing",
    label: "My power, averaged over",
    type: "select",
    options: [1, 3, 5, 10].map((s) => ({ value: s, label: s === 1 ? "1 second" : `${s} seconds` })),
  },
  {
    key: "tolerance",
    label: "On target within",
    type: "select",
    options: [0.03, 0.05, 0.1].map((t) => ({ value: t, label: `±${Math.round(t * 100)}%` })),
  },
  {
    key: "countdown",
    label: "Countdown into each change",
    type: "select",
    options: [
      { value: 0, label: "Off" },
      { value: 5, label: "Last 5 seconds" },
      { value: 10, label: "Last 10 seconds" },
      { value: 15, label: "Last 15 seconds" },
    ],
  },
  { key: "beep", label: "Beep for the last 3 seconds", type: "toggle" },
  { key: "scorecard", label: "Scorecard after each interval", type: "toggle" },
  { key: "hideWhenNone", label: "Hide when not in a workout", type: "toggle" },
  { key: "debug", label: "Show Zwift's raw workout data", type: "toggle" },
];

/** A scorecard stays up this long. */
const CARD_MS = 8000;
/** A workout message shows for this long from its time. */
const CUE_S = 10;
/** Steps shorter than this get no scorecard. */
const CARD_MIN_S = 20;

interface Tally {
  n: number;
  watts: number;
  hr: number;
  hrN: number;
  inRange: number;
  target: number;
}

type Grade = "good" | "close" | "off";

interface Card {
  name: string;
  avg: number;
  target: number;
  inRange: number;
  hr?: number;
  grade: Grade;
  at: number;
}

function grade(t: Tally): Grade | undefined {
  if (t.n < 5 || !t.target) return undefined;
  const off = Math.abs(t.watts / t.n - t.target / t.n) / (t.target / t.n);
  const inRange = t.inRange / t.n;
  return off <= 0.05 && inRange >= 0.7 ? "good" : off <= 0.1 ? "close" : "off";
}

function WorkoutOverlay() {
  const [settings, set] = useSettings("workout", DEFAULTS);
  const { address, watching, status: feed } = useSauce({});
  const example = settings.example;
  const w = useWorkout(address, watching, example, EXAMPLE_FILE, EXAMPLE_AT);
  const { plan, at, ftp, bias, distance } = w;
  const hash = example ? -1 : plan ? plan.total * 1000 + plan.steps.length : 0;
  const state = { isPaused: w.paused, isFinished: w.finished, isInERGMode: w.erg };
  const watts = (share: number | undefined) => (share != null && ftp ? share * ftp * bias : undefined);

  const i = plan && at != null ? stepAt(plan, at) : -1;
  const step: Step | undefined = plan?.steps[i];
  const next: Step | undefined = plan?.steps[i + 1];
  const targetNow = step && at != null ? watts(targetAt(step, at)) : undefined;

  // The rider's power, averaged as chosen, and everything tallied per step.
  const recent = useRef<{ t: number; w: number }[]>([]);
  const trace = useRef<{ hash: number; points: [number, number][] }>({ hash: 0, points: [] });
  const tallies = useRef<{ hash: number; byStep: Map<number, Tally> }>({ hash: 0, byStep: new Map() });
  const [card, setCard] = useState<Card | null>(null);
  const lastStep = useRef(-1);
  if (trace.current.hash !== hash) trace.current = { hash, points: [] };
  if (tallies.current.hash !== hash) tallies.current = { hash, byStep: new Map() };

  const power = example ? (targetNow ?? 0) * (1 + Math.sin(Date.now() / 700) * 0.025) : watching?.state?.power;
  useEffect(() => {
    if (power == null || example) return;
    const now = Date.now();
    recent.current = [...recent.current.filter((r) => now - r.t < 10_000), { t: now, w: power }];
  }, [watching]); // eslint-disable-line react-hooks/exhaustive-deps
  const smooth = (() => {
    if (example) return power;
    const now = Date.now();
    const within = recent.current.filter((r) => now - r.t <= settings.smoothing * 1000 + 300);
    return within.length ? within.reduce((a, r) => a + r.w, 0) / within.length : power;
  })();

  // Each Sauce update is a second of riding: traced and counted against the target.
  useEffect(() => {
    if (example || at == null || i < 0 || power == null || state?.isPaused) return;
    const pts = trace.current.points;
    if (!pts.length || at - pts[pts.length - 1][0] >= 1) pts.push([at, power]);
    if (targetNow == null || smooth == null) return;
    const t = tallies.current.byStep.get(i) ?? { n: 0, watts: 0, hr: 0, hrN: 0, inRange: 0, target: 0 };
    t.n++;
    t.watts += power;
    t.target += targetNow;
    if (Math.abs(smooth - targetNow) <= targetNow * settings.tolerance) t.inRange++;
    const hr = watching?.state?.heartrate;
    if (hr) {
      t.hr += hr;
      t.hrN++;
    }
    tallies.current.byStep.set(i, t);
  }, [watching]); // eslint-disable-line react-hooks/exhaustive-deps

  // An interval over: its scorecard.
  useEffect(() => {
    const was = lastStep.current;
    lastStep.current = i;
    if (example || !plan || was < 0 || i <= was) return;
    const done = plan.steps[was];
    const t = tallies.current.byStep.get(was);
    const g = t && grade(t);
    // The work only - intervals and steady efforts, not recoveries, warm-up, cool-down, ramps or free riding.
    const scored = done.kind === "on" || done.kind === "steady";
    if (!settings.scorecard || !scored || !t || !g || done.length < CARD_MIN_S || done.from == null) return;
    setCard({
      name: stepName(done),
      avg: t.watts / t.n,
      target: t.target / t.n,
      inRange: t.inRange / t.n,
      hr: t.hrN ? t.hr / t.hrN : undefined,
      grade: g,
      at: Date.now(),
    });
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!card) return;
    const t = setTimeout(() => setCard(null), CARD_MS);
    return () => clearTimeout(t);
  }, [card]);

  // The countdown into the next step, with a beep for the last three seconds if wanted.
  const left = step && at != null ? step.start + step.length - at : undefined;
  const counting = !distance && settings.countdown > 0 && left != null && left <= settings.countdown && !!next;
  const beeped = useRef<number | null>(null);
  useEffect(() => {
    if (!counting || !settings.beep || left == null || example) return;
    const s = Math.ceil(left);
    if (s > 3 || s < 1 || beeped.current === s) return;
    beeped.current = s;
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = s === 1 ? 1320 : 880;
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
      osc.onended = () => void ctx.close();
    } catch {
      // No sound available: the countdown still shows.
    }
  });

  const fmt = (v: number) => (distance ? `${(v / 1000).toFixed(v < 10_000 ? 2 : 1)} km` : clock(v));
  const exampleGrades: Map<number, Grade> = useMemo(() => {
    const m = new Map<number, Grade>();
    if (example && plan) plan.steps.forEach((s, k) => s.start + s.length <= EXAMPLE_AT && s.from != null && m.set(k, k === 3 ? "close" : "good"));
    return m;
  }, [example, plan]);
  const gradeOf = (k: number): Grade | undefined => (example ? exampleGrades.get(k) : (() => {
    const t = tallies.current.byStep.get(k);
    return t && k < i ? grade(t) : undefined;
  })());
  const shownCard: Card | null = example
    ? { name: "Interval 2/4", avg: 297, target: 294, inRange: 0.92, hr: 164, grade: "good", at: 0 }
    : card;

  // In a workout without its blocks yet: how far through it, and the
  // workout to pick from Zwift so the blocks can be drawn.
  if (!plan && w.inWorkout && !example) {
    const progress = Math.max(0, Math.min(1, w.progress ?? 0));
    const zone = w.zone ?? 1;
    const color = POWER_ZONES[Math.min(POWER_ZONES.length, zone) - 1]?.color ?? zoneColor(1);
    const now = watching?.state?.power;
    return (
      <OverlayShell title="Workout" settings={settings} setSetting={set} defs={DEFS}>
        <div className={`${shell.panel} ${styles.panel}`}>
          <div className={styles.top}>
            <span className={styles.item}>
              <span className={styles.lbl}>Workout</span>
              <span className={styles.big}>{Math.round(progress * 100)}% done</span>
            </span>
            <span className={styles.item}>
              <span className={styles.lbl}>Zone</span>
              <span className={styles.big} style={{ color }}>
                Z{zone}
              </span>
            </span>
            <span className={styles.item}>
              <span className={styles.lbl}>You</span>
              <span className={styles.num}>
                {now != null ? Math.round(now) : "–"}
                <small>W</small>
              </span>
            </span>
            <span className={styles.spacer} />
            <WorkoutPicker w={w} />
          </div>
          <div className={styles.progressTrack}>
            <span className={styles.progressFill} style={{ width: `${progress * 100}%`, background: color }} />
          </div>
          {settings.debug && <pre className={styles.debug}>{JSON.stringify(w.raw, null, 1)?.slice(0, 1500)}</pre>}
        </div>
      </OverlayShell>
    );
  }

  if (!plan || at == null) {
    const why =
      feed !== "connected"
        ? "Connecting to Sauce…"
        : w.inWorkout
          ? "Reading the workout…"
          : "Workout strip appears when you start a Zwift workout";
    return (
      <OverlayShell title="Workout" settings={settings} setSetting={set} defs={DEFS}>
        <div className={settings.hideWhenNone ? styles.idle : `${shell.panel} ${styles.waitingPanel}`}>
          {why}
          {settings.hideWhenNone && " · right-click for settings"}
          {settings.debug && <pre className={styles.debug}>{JSON.stringify(w.raw, null, 1)?.slice(0, 1500)}</pre>}
        </div>
      </OverlayShell>
    );
  }

  const total = plan.total;
  const top = Math.max(1.3, ...plan.steps.map((s) => Math.max(s.from ?? 0, s.to ?? 0))) * 1.08;
  const x = (v: number) => (v / total) * 1000;
  const y = (share: number) => 100 - (share / top) * 100;
  const trail = example
    ? Array.from({ length: 300 }, (_, k): [number, number] => {
        const t = (k / 300) * EXAMPLE_AT;
        const s = plan.steps[stepAt(plan, t)];
        return [t, (watts(targetAt(s, t)) ?? (ftp ?? 280) * 0.6) * (1 + Math.sin(k * 1.7) * 0.03 + Math.sin(k * 0.31) * 0.03)];
      })
    : trace.current.points;
  const tracePath = ftp ? trail.map(([t, w], k) => `${k ? "L" : "M"}${x(t).toFixed(1)} ${y(w / ftp / bias).toFixed(1)}`).join("") : "";
  const off = smooth != null && targetNow ? (smooth - targetNow) / targetNow : undefined;
  const onTarget = off != null && Math.abs(off) <= settings.tolerance;
  const tally = tallies.current.byStep.get(i);
  const inRangeNow = example ? 0.94 : tally && tally.n ? tally.inRange / tally.n : undefined;
  const stars = w.stars ?? 0;
  const doneCount = plan.steps.filter((s, k) => k < i && s.kind === "on").length;
  const onCount = plan.steps.filter((s) => s.kind === "on").length;
  const cue = plan.cues.find((c) => at! >= c.at && at! < c.at + CUE_S);
  const nextTarget = next ? watts(next.from) : undefined;

  return (
    <OverlayShell title="Workout" settings={settings} setSetting={set} defs={DEFS}>
      <div className={`${shell.panel} ${styles.panel}`}>
        <div className={styles.top}>
          {plan.name && <span className={styles.name}>{plan.name}</span>}
          <span className={styles.item}>
            <span className={styles.lbl}>Now</span>
            <span className={styles.big}>{step ? stepName(step) : "–"}</span>
          </span>
          <span className={styles.item}>
            <span className={styles.lbl}>Target</span>
            <span className={styles.num}>
              {targetNow != null ? Math.round(targetNow) : step?.kind === "max" ? "Max" : "Free"}
              {targetNow != null && <small>W</small>}
            </span>
            {step?.from != null && at != null && <span className={styles.lbl}>{Math.round((targetAt(step, at) ?? 0) * bias * 100)}% FTP</span>}
          </span>
          <span className={styles.item}>
            <span className={styles.lbl}>You</span>
            <span className={`${styles.num} ${off == null ? "" : onTarget ? styles.good : styles.warn}`}>
              {smooth != null ? Math.round(smooth) : "–"}
              <small>W</small>
            </span>
          </span>
          {left != null && (
            <span className={styles.item}>
              <span className={styles.lbl}>Block left</span>
              <span className={styles.num}>{fmt(left)}</span>
            </span>
          )}
          {settings.gauge && targetNow != null && off != null && (
            <span className={styles.gauge} title={`Within ±${Math.round(settings.tolerance * 100)}% of the target counts as on target`}>
              {/* The gauge runs from 20% under to 20% over the target. */}
              <span className={styles.band} style={{ width: `${settings.tolerance * 500}%`, marginLeft: `${-settings.tolerance * 250}%` }} />
              <span
                className={`${styles.needle} ${onTarget ? styles.needleGood : styles.needleWarn}`}
                style={{ left: `${50 + Math.max(-0.2, Math.min(0.2, off)) * 250}%` }}
              />
              {inRangeNow != null && <span className={styles.inRange}>{Math.round(inRangeNow * 100)}% on target</span>}
            </span>
          )}
          <span className={styles.spacer} />
          {next && (
            <span className={`${styles.item} ${styles.shrink}`}>
              <span className={styles.lbl}>Next</span>
              <span className={styles.big}>
                {stepName(next)}
                {nextTarget != null ? ` ${Math.round(nextTarget)} W` : ""} · {fmt(next.length)}
              </span>
            </span>
          )}
          <span className={styles.item}>
            <span className={styles.lbl}>Workout left</span>
            <span className={styles.big}>{fmt(total - at)}</span>
          </span>
        </div>

        <div className={styles.chart}>
          <svg viewBox="0 0 1000 100" preserveAspectRatio="none" className={styles.svg} aria-hidden>
            <defs>
              <pattern id="free" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="3" height="6" fill="rgba(var(--hud-ink), 0.22)" />
              </pattern>
            </defs>
            {plan.steps.map((s, k) => {
              const x0 = x(s.start);
              const x1 = x(s.start + s.length);
              const free = s.from == null;
              const y0 = free ? y(s.kind === "max" ? top * 0.95 : 0.5) : y(s.from!);
              const y1 = free ? y0 : y(s.to ?? s.from!);
              const fill = free ? (s.kind === "max" ? zoneColor(2) : "url(#free)") : zoneColor(Math.max(s.from!, s.to ?? 0));
              const g = gradeOf(k);
              return (
                <g key={k} className={k < i ? styles.done : k === i ? styles.current : ""}>
                  <path d={`M${x0} 100L${x0} ${y0}L${x1} ${y1}L${x1} 100Z`} fill={fill} className={styles.block} vectorEffect="non-scaling-stroke" />
                  {g && <rect x={x0} width={Math.max(1, x1 - x0)} y={97} height={3} className={styles[g]} />}
                </g>
              );
            })}
            <line x1={0} x2={1000} y1={y(1 / bias)} y2={y(1 / bias)} className={styles.ftp} vectorEffect="non-scaling-stroke" />
            {settings.trace && tracePath && <path d={tracePath} className={styles.trace} vectorEffect="non-scaling-stroke" />}
          </svg>
          <span className={styles.cursor} style={{ left: `${(at / total) * 100}%` }} />
          {counting && left != null && (
            <span className={`${styles.countdown} ${at / total > 0.8 ? styles.countdownLeft : ""}`} style={{ left: `${(at / total) * 100}%` }}>
              <b>{Math.ceil(left)}</b>
              <small>
                then {next ? stepName(next) : ""}
                {nextTarget != null ? ` · ${Math.round(nextTarget)} W` : ""}
              </small>
            </span>
          )}
          {settings.scorecard && shownCard && (
            <span className={`${styles.card} ${styles[`card_${shownCard.grade}`]}`}>
              <b>{shownCard.name}</b>
              <span>
                {Math.round(shownCard.avg)} W <small>avg · target {Math.round(shownCard.target)}</small>
              </span>
              <span>
                {Math.round(shownCard.inRange * 100)}% on target{shownCard.hr ? ` · ${Math.round(shownCard.hr)} bpm` : ""}
              </span>
            </span>
          )}
          {cue && <span className={styles.cue}>{cue.message}</span>}
        </div>

        <div className={styles.foot}>
          <span>{fmt(0)}</span>
          <span className={styles.chips}>
            {(example || state?.isInERGMode) && <span className={styles.chip}>ERG</span>}
            {state?.isPaused && <span className={styles.chip}>Paused</span>}
            {state?.isFinished && <span className={styles.chip}>Finished</span>}
            <span>Intensity {Math.round(bias * 100)}%</span>
            {onCount > 0 && (
              <span>
                · {doneCount} of {onCount} intervals done
              </span>
            )}
            {stars > 0 && <span>· {"★".repeat(Math.min(stars, 10))}</span>}
            {example && <span className={styles.chip}>Example</span>}
            {w.source === "zwift" && <WorkoutPicker w={w} compact />}
          </span>
          <span>{fmt(total)}</span>
        </div>
        {settings.debug && (
          <pre className={styles.debug}>
            {JSON.stringify({ source: w.source, at: at != null ? Math.round(at) : null, step: i, total, raw: w.raw }, null, 1).slice(0, 1500)}
          </pre>
        )}
      </div>
    </OverlayShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WorkoutOverlay />
  </StrictMode>,
);
