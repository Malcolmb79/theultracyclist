import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { OverlayShell, useSettings, type SettingDef } from "./overlay";
import { useSauce } from "./useSauce";
import { useWorkout } from "./useWorkout";
import { stepAt, stepName, targetAt, type Step } from "./workoutPlan";
import { EXAMPLE_AT, EXAMPLE_FILE, clock } from "./workoutExample";
import { POWER_ZONES, zoneColor } from "./zones";
import WorkoutPicker from "./WorkoutPicker";
import shell from "./Overlay.module.css";
import styles from "./WorkoutPanel.module.css";

// The workout as Zwift lists it beside the power - the workout's name and
// how long to the finish, the block being ridden (big, with its own
// countdown) and the ones coming - in the overlays' look, to replace
// Zwift's own. Same workout as the strip (useWorkout).

const DEFAULTS = { opacity: 80, example: false, upcoming: 3, units: "watts", hideWhenNone: false };
const DEFS: SettingDef[] = [
  { key: "example", label: "Show an example (for placing it)", type: "toggle" },
  { key: "upcoming", label: "Blocks coming up", type: "select", options: [1, 2, 3, 5, 8].map((n) => ({ value: n, label: String(n) })) },
  {
    key: "units",
    label: "Targets in",
    type: "select",
    options: [
      { value: "watts", label: "Watts" },
      { value: "ftp", label: "% of FTP" },
      { value: "wkg", label: "W/kg" },
    ],
  },
  { key: "hideWhenNone", label: "Hide when not in a workout", type: "toggle" },
];

/** "10 min", "1 min 30", "45 s" - the way Zwift writes a block's length. */
function length(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (!m) return `${s} s`;
  return s ? `${m} min ${s}` : `${m} min`;
}

function WorkoutPanel() {
  const [settings, set] = useSettings("workoutPanel", DEFAULTS);
  const { address, watching, status: feed } = useSauce({});
  const example = settings.example;
  const w = useWorkout(address, watching, example, EXAMPLE_FILE, EXAMPLE_AT);
  const { plan, at, ftp, bias } = w;
  const kg = watching?.athlete?.weight ?? (example ? 75 : undefined);

  /** A target, as chosen: watts, % of FTP or W/kg. */
  const target = (share: number | undefined): string | undefined => {
    if (share == null) return undefined;
    const s = share * bias;
    if (settings.units === "ftp" || !ftp) return `${Math.round(s * 100)}%`;
    if (settings.units === "wkg" && kg) return `${((s * ftp) / kg).toFixed(1)} W/kg`;
    return `${Math.round(s * ftp)} W`;
  };

  /** A block in a line, the way Zwift lists it: "40 min @ 175 W", "10 min warm-up 140–210 W". */
  const describe = (s: Step): string => {
    const len = w.distance ? `${(s.length / 1000).toFixed(1)} km` : length(s.length);
    if (s.from == null) return `${len} ${s.kind === "max" ? "max effort" : "free ride"}`;
    const a = target(s.from)!;
    const b = target(s.to ?? s.from)!;
    const range = a === b ? `@ ${a}` : `${a.replace(/ .*$/, "")}–${b}`;
    const what = s.kind === "warmup" ? "warm-up " : s.kind === "cooldown" ? "cool-down " : s.kind === "ramp" ? "ramp " : "";
    const rep = s.reps && s.reps > 1 ? ` (${s.rep}/${s.reps})` : "";
    return `${len} ${what}${range}${rep}`;
  };

  if (!plan || at == null) {
    if (w.inWorkout && !example) {
      const progress = Math.max(0, Math.min(1, w.progress ?? 0));
      const color = POWER_ZONES[Math.min(POWER_ZONES.length, w.zone ?? 1) - 1]?.color;
      return (
        <OverlayShell title="Workout panel" settings={settings} setSetting={set} defs={DEFS}>
          <div className={`${shell.panel} ${styles.panel}`}>
            <div className={styles.title}>Workout · {Math.round(progress * 100)}% done</div>
            <div className={styles.bar}>
              <span style={{ width: `${progress * 100}%`, background: color }} />
            </div>
            <WorkoutPicker w={w} />
          </div>
        </OverlayShell>
      );
    }
    return (
      <OverlayShell title="Workout panel" settings={settings} setSetting={set} defs={DEFS}>
        <div className={settings.hideWhenNone ? styles.idle : `${shell.panel} ${styles.panel} ${styles.waiting}`}>
          {feed !== "connected" ? "Connecting to Sauce…" : "Your workout appears here when you start one in Zwift"}
          {settings.hideWhenNone && " · right-click for settings"}
        </div>
      </OverlayShell>
    );
  }

  const i = stepAt(plan, at);
  const step = plan.steps[i];
  const left = step.start + step.length - at;
  const upcoming = plan.steps.slice(i + 1, i + 1 + settings.upcoming);
  const done = at / plan.total;
  const shareNow = targetAt(step, at);
  const color = shareNow != null ? zoneColor(shareNow * bias) : "rgba(var(--hud-ink), 0.4)";

  return (
    <OverlayShell title="Workout panel" settings={settings} setSetting={set} defs={DEFS}>
      <div className={`${shell.panel} ${styles.panel}`}>
        <div className={styles.head}>
          <span className={styles.title}>{plan.name ?? "Workout"}</span>
          {example && <span className={styles.tag}>Example</span>}
        </div>
        <div className={styles.bar}>
          <span style={{ width: `${done * 100}%` }} />
        </div>
        <div className={styles.finish}>
          Finish in <b>{w.distance ? `${((plan.total - at) / 1000).toFixed(1)} km` : clock(plan.total - at)}</b>
        </div>

        {/* The block being ridden: what it is, its target now and how long is left. */}
        <div className={styles.current} style={{ ["--zone" as string]: color }}>
          <span className={styles.fill} style={{ width: `${Math.min(1, (at - step.start) / step.length) * 100}%` }} />
          <span className={styles.what}>
            {stepName(step)}
            <small>{describe(step)}</small>
          </span>
          <span className={styles.now}>
            <b>{target(shareNow) ?? (step.kind === "max" ? "Max" : "Free")}</b>
            <small>{w.distance ? `${(left / 1000).toFixed(2)} km` : clock(left)} left</small>
          </span>
        </div>

        <ol className={styles.next}>
          {upcoming.map((s, k) => (
            <li key={i + 1 + k} style={{ ["--zone" as string]: s.from != null ? zoneColor(Math.max(s.from, s.to ?? 0) * bias) : "rgba(var(--hud-ink), 0.3)" }}>
              {describe(s)}
            </li>
          ))}
          {!upcoming.length && <li className={styles.last}>Last block - nearly there</li>}
        </ol>

        <div className={styles.foot}>
          <span>Intensity {Math.round(bias * 100)}%</span>
          {w.erg && <span className={styles.chip}>ERG</span>}
          {w.paused && <span className={styles.chip}>Paused</span>}
          <span className={styles.spacer} />
          {w.stars != null && w.stars > 0 && <span className={styles.stars}>★ {w.stars}</span>}
          {w.source === "zwift" && <WorkoutPicker w={w} compact />}
        </div>
      </div>
    </OverlayShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WorkoutPanel />
  </StrictMode>,
);
