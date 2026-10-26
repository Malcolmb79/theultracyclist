import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import type { RouteGeometry } from "../components/race/courseMap";
import { OverlayShell, useSettings, type SettingDef } from "./overlay";
import { useSauce } from "./useSauce";
import { routePosition, useCourse } from "./useCourse";
import { elevationAt, findClimb, gradeColor, type Climb, type ClimbSensitivity } from "./climb";
import shell from "./Overlay.module.css";
import styles from "./ClimbView.module.css";

// The climb pop-up Zwift shows on a climb: it appears as the road starts to
// rise (or just before, if chosen), shows the gradient now, what's left to
// the top and a profile of the climb shaded by steepness, and goes once the
// rider is over the top.

const DEFAULTS = { opacity: 80, sensitivity: "zwift", ahead: 300, profile: true, average: true, height: true, progress: true, steepest: false };
const DEFS: SettingDef[] = [
  {
    key: "sensitivity",
    label: "Pops up for",
    type: "select",
    options: [
      { value: "zwift", label: "Every rise, like Zwift" },
      { value: "standard", label: "Proper climbs" },
      { value: "big", label: "Big climbs only" },
    ],
  },
  {
    key: "ahead",
    label: "Show before the climb",
    type: "select",
    options: [
      { value: 0, label: "Only on it" },
      { value: 300, label: "300 m out" },
      { value: 1000, label: "1 km out" },
    ],
  },
  { key: "profile", label: "Climb profile", type: "toggle" },
  { key: "average", label: "Average gradient", type: "toggle" },
  { key: "height", label: "Height to go", type: "toggle" },
  { key: "progress", label: "Progress bar", type: "toggle" },
  { key: "steepest", label: "Steepest pitch", type: "toggle" },
];

/** How long the pop-up stays after the top, to see the climb out. */
const LINGER_MS = 6000;
const SLICES = 24;

function ClimbProfile({ route, climb, at }: { route: RouteGeometry; climb: Climb; at: number }) {
  const len = climb.top - climb.start;
  // Scaled to the climb's own lowest and highest points, dips included.
  const heights = Array.from({ length: SLICES + 1 }, (_, k) => elevationAt(route, climb.start + (len * k) / SLICES));
  const lo = Math.min(...heights);
  const range = Math.max(Math.max(...heights) - lo, 10);
  const x = (d: number) => ((d - climb.start) / len) * 1000;
  const y = (d: number) => 95 - ((elevationAt(route, d) - lo) / range) * 85;
  // Each slice of the climb filled in the colour of its gradient.
  const slices = Array.from({ length: SLICES }, (_, k) => {
    const a = climb.start + (len * k) / SLICES;
    const b = climb.start + (len * (k + 1)) / SLICES;
    const pct = ((elevationAt(route, b) - elevationAt(route, a)) / (b - a)) * 100;
    return { d: `M${x(a)} 100L${x(a)} ${y(a)}L${x(b)} ${y(b)}L${x(b)} 100Z`, color: gradeColor(pct) };
  });
  const pos = Math.max(climb.start, Math.min(climb.top, at));
  return (
    <div className={styles.profile}>
      <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden>
        {slices.map((s, i) => (
          <path key={i} d={s.d} fill={s.color} fillOpacity={0.85} />
        ))}
        {at >= climb.start && <rect x={0} width={x(pos)} y={0} height={100} fill="rgba(var(--hud-bg), 0.45)" />}
      </svg>
      {at >= climb.start && <span className={styles.me} style={{ left: `${(x(pos) / 1000) * 100}%`, top: `${y(pos)}%` }} />}
    </div>
  );
}

function ClimbOverlay() {
  const [settings, set] = useSettings("climb", DEFAULTS);
  const { address, watching } = useSauce({});
  const { route } = useCourse(address, watching);
  const s = watching?.state;
  const at = route ? routePosition(route, s?.routeDistance) : undefined;
  const found = route && at != null ? findClimb(route, at, settings.ahead, settings.sensitivity as ClimbSensitivity) : undefined;

  // Keep the climb up for a few seconds over the top.
  const last = useRef<{ climb: Climb; at: number } | null>(null);
  const [, tick] = useState(0);
  if (found) last.current = { climb: found, at: Date.now() };
  const climb = found ?? (last.current && Date.now() - last.current.at < LINGER_MS ? last.current.climb : undefined);
  useEffect(() => {
    if (found || !last.current) return;
    const t = setTimeout(() => tick((n) => n + 1), LINGER_MS);
    return () => clearTimeout(t);
  }, [found]);

  const gradeNow = s?.grade != null ? s.grade * 100 : undefined;
  const before = climb && at != null && at < climb.start;
  const over = climb && at != null && at >= climb.top;
  const toTop = climb && at != null ? Math.max(0, climb.top - Math.max(at, climb.start)) : 0;
  const heightLeft = climb && route && at != null ? Math.max(0, elevationAt(route, climb.top) - elevationAt(route, Math.max(at, climb.start))) : 0;
  const done = climb && at != null ? Math.max(0, Math.min(1, (at - climb.start) / (climb.top - climb.start))) : 0;

  return (
    <OverlayShell title="Climb pop-up" settings={settings} setSetting={set} defs={DEFS}>
      {climb && route && at != null ? (
        <div className={`${shell.panel} ${styles.panel}`} style={{ borderColor: gradeColor(climb.avgPct) }}>
          <div className={styles.head}>
            <span className={styles.name}>{climb.name ?? "Climb"}</span>
            <span className={styles.length}>
              {(climb.top - climb.start) >= 1000 ? `${((climb.top - climb.start) / 1000).toFixed(1)} km` : `${Math.round(climb.top - climb.start)} m`}
            </span>
          </div>
          <div className={styles.body}>
            <span className={styles.grade} style={{ color: gradeNow != null ? gradeColor(gradeNow) : undefined }}>
              {gradeNow != null ? gradeNow.toFixed(1) : "–"}
              <small>%</small>
            </span>
            <span className={styles.facts}>
              {over ? (
                <b>Over the top!</b>
              ) : before ? (
                <b>Starts in {Math.round(climb.start - at)} m</b>
              ) : (
                <b>{toTop >= 1000 ? `${(toTop / 1000).toFixed(2)} km` : `${Math.round(toTop)} m`} to the top</b>
              )}
              {settings.height && !over && <span>{Math.round(heightLeft)} m to climb</span>}
              {settings.average && <span>{climb.avgPct.toFixed(1)}% average</span>}
              {settings.steepest && <span>{climb.maxPct.toFixed(0)}% at its steepest</span>}
            </span>
          </div>
          {settings.profile && <ClimbProfile route={route} climb={climb} at={at} />}
          {settings.progress && (
            <div className={styles.progress} aria-hidden>
              <span style={{ width: `${done * 100}%` }} />
            </div>
          )}
        </div>
      ) : (
        // Nothing to show: an empty window that still takes a right-click.
        <div className={styles.idle}>Climb pop-up appears on climbs · right-click for settings</div>
      )}
    </OverlayShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ClimbOverlay />
  </StrictMode>,
);
