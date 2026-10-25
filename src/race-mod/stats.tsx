import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { athleteName } from "../components/race/sauceFeed";
import { formatElapsed } from "../components/race/raceLog";
import { OverlayShell, useSettings, type SettingDef } from "./overlay";
import { useSauce } from "./useSauce";
import shell from "./Overlay.module.css";
import styles from "./Stats.module.css";

// The ride numbers Zwift shows top centre - speed, distance, climbing, time -
// and who's being watched, in The Ultra Cyclist's look.

const DEFAULTS = { opacity: 80, speed: true, distance: true, climbing: true, time: true, watching: true, gradient: false };
const DEFS: SettingDef[] = [
  { key: "speed", label: "Speed", type: "toggle" },
  { key: "distance", label: "Distance", type: "toggle" },
  { key: "climbing", label: "Climbing", type: "toggle" },
  { key: "time", label: "Time", type: "toggle" },
  { key: "gradient", label: "Gradient", type: "toggle" },
  { key: "watching", label: "Who you're watching", type: "toggle" },
];

function StatsOverlay() {
  const [settings, set] = useSettings("stats", DEFAULTS);
  const { watching } = useSauce({});
  const s = watching?.state;
  // In an event the distance counts from its start banner, as Zwift's does.
  const metres = s?.eventDistance && s.eventDistance > 0 ? s.eventDistance : s?.distance;
  const stats = [
    settings.speed && { value: s?.speed != null ? Math.round(s.speed) : "–", unit: "km/h" },
    settings.distance && { value: metres != null ? (metres / 1000).toFixed(1) : "–", unit: "km" },
    settings.climbing && { value: s?.climbing != null ? Math.round(s.climbing) : "–", unit: "m" },
    settings.time && { value: s?.time != null ? formatElapsed(s.time * 1000) : "–", unit: "" },
    settings.gradient && { value: s?.grade != null ? `${(s.grade * 100).toFixed(1)}` : "–", unit: "%" },
  ].filter(Boolean) as { value: string | number; unit: string }[];

  return (
    <OverlayShell title="Ride stats" settings={settings} setSetting={set} defs={DEFS}>
      <div className={styles.wrap}>
        {stats.length > 0 && (
          <div className={`${shell.panel} ${styles.stats}`}>
            {stats.map((x, i) => (
              <span key={i} className={styles.stat}>
                <span className={styles.value}>{x.value}</span>
                {x.unit && <span className={styles.unit}>{x.unit}</span>}
              </span>
            ))}
          </div>
        )}
        {settings.watching && watching && !watching.self && (
          <div className={styles.watching}>Watching {athleteName(watching)}</div>
        )}
      </div>
    </OverlayShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StatsOverlay />
  </StrictMode>,
);
