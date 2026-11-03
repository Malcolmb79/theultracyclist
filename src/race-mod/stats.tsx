import { StrictMode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { athleteName } from "../components/race/sauceFeed";
import { formatElapsed } from "../components/race/raceLog";
import { OverlayShell, useSettings, type SettingDef } from "./overlay";
import { useSauce } from "./useSauce";
import { SITE } from "./site";
import shell from "./Overlay.module.css";
import styles from "./Stats.module.css";

// The ride numbers Zwift shows top centre - speed, distance, climbing, time -
// with the rider's level, how far through it and their Drops, and who's
// being watched, in The Ultra Cyclist's look. Level progress and Drops come
// from the rider's Zwift profile through the site (Sauce doesn't carry
// them); Zwift updates them when it saves the ride, every few minutes.

const DEFAULTS = { opacity: 80, fit: true, speed: true, distance: true, climbing: true, time: true, watching: true, gradient: false, level: true, drops: true, progress: true };
const DEFS: SettingDef[] = [
  { key: "fit", label: "Size to the window (drag a corner)", type: "toggle" },
  { key: "speed", label: "Speed", type: "toggle" },
  { key: "distance", label: "Distance", type: "toggle" },
  { key: "climbing", label: "Climbing", type: "toggle" },
  { key: "time", label: "Time", type: "toggle" },
  { key: "gradient", label: "Gradient", type: "toggle" },
  { key: "watching", label: "Who you're watching", type: "toggle" },
  { key: "level", label: "Level", type: "toggle" },
  { key: "progress", label: "Progress to the next level", type: "toggle" },
  { key: "drops", label: "Drops", type: "toggle" },
];

interface Profile {
  configured?: boolean;
  level?: number;
  levelPct?: number;
  drops?: number;
  error?: string;
}

/** Asked for about once a minute: the site keeps it for that long, and Zwift updates it every few. */
const PROFILE_EVERY_MS = 60_000;

/** The race key the mod's radio overlays already keep, shared by every mod window. */
function raceKey(): string | null {
  try {
    const raw = window.localStorage.getItem("race:commentary-key");
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return typeof v === "string" && v ? v : null;
  } catch {
    return null;
  }
}

/** The rider's level, progress and Drops from their Zwift profile, while any of them is shown. */
function useProfile(on: boolean): Profile | null {
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    const key = raceKey();
    if (!on || !key) return;
    let live = true;
    const load = () =>
      void fetch(`${SITE}/api/zwift-profile`, { headers: { authorization: `Bearer ${key}` }, credentials: "omit" })
        .then((r) => (r.ok ? (r.json() as Promise<Profile>) : null))
        .then((p) => live && p && setProfile(p))
        .catch(() => undefined);
    load();
    const t = setInterval(load, PROFILE_EVERY_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [on]);
  return profile;
}

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

  // Level, progress and Drops are the rider's own: shown while they're the one riding.
  const profile = useProfile(settings.level || settings.drops || settings.progress);
  const own = watching?.self !== false && profile?.configured !== false && !profile?.error ? profile : null;
  const level = settings.level ? (own?.level ?? (watching?.self !== false ? watching?.athlete?.level : undefined)) : undefined;
  const pct = settings.progress ? own?.levelPct : undefined;
  const drops = settings.drops ? own?.drops : undefined;

  // Sized to the window: the bar drawn at its natural size, then scaled to
  // fill the window - so dragging the window's corner makes it as big as
  // Zwift's own ride stats, to sit over them.
  const inner = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    if (!settings.fit) {
      setScale(1);
      return;
    }
    const fit = () => {
      const el = inner.current;
      if (!el || !el.offsetWidth || !el.offsetHeight) return;
      const next = Math.max(0.3, Math.min(window.innerWidth / el.offsetWidth, window.innerHeight / el.offsetHeight));
      setScale((was) => (Math.abs(was - next) < 0.005 ? was : next));
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (inner.current) ro.observe(inner.current);
    window.addEventListener("resize", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  });

  return (
    <OverlayShell title="Ride stats" settings={settings} setSetting={set} defs={DEFS}>
      <div className={settings.fit ? styles.fitFrame : undefined}>
      <div ref={inner} className={`${styles.wrap} ${settings.fit ? styles.fitted : ""}`} style={settings.fit ? { transform: `scale(${scale})` } : undefined}>
        {stats.length > 0 && (
          <div className={`${shell.panel} ${styles.stats}`}>
            <div className={styles.row}>
              {stats.map((x, i) => (
                <span key={i} className={styles.stat}>
                  <span className={styles.value}>{x.value}</span>
                  {x.unit && <span className={styles.unit}>{x.unit}</span>}
                </span>
              ))}
            </div>
            {pct != null && (
              <div className={styles.progress} title={`${pct}% of the way to level ${(level ?? 0) + 1}`}>
                <span style={{ width: `${pct}%` }} />
              </div>
            )}
            {(level != null || drops != null) && (
              <div className={styles.badges}>
                {level != null ? (
                  <span className={styles.badge} title="Zwift level">
                    <span className={styles.badgeIcon}>🚲</span>
                    {level}
                  </span>
                ) : (
                  <span />
                )}
                {drops != null && (
                  <span className={`${styles.badge} ${styles.drops}`} title="Drops">
                    {drops.toLocaleString("en-GB")}
                    <span className={styles.badgeIcon}>💧</span>
                  </span>
                )}
              </div>
            )}
          </div>
        )}
        {settings.watching && watching && !watching.self && (
          <div className={styles.watching}>Watching {athleteName(watching)}</div>
        )}
      </div>
      </div>
    </OverlayShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StatsOverlay />
  </StrictMode>,
);
