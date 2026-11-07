import { StrictMode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { athleteName } from "../components/race/sauceFeed";
import { formatElapsed } from "../components/race/raceLog";
import { OverlayShell, useSettings, type SettingDef } from "./overlay";
import { useSauce } from "./useSauce";
import { SITE } from "./site";
import { routePosition, useCourse } from "./useCourse";
import { CLIMB_DEFAULTS, ClimbCard, useClimb, type ClimbSettings } from "./climbCard";
import FieldPicker from "./FieldPicker";
import { colourOf, display, type RiderField } from "./riderFields";
import { STAT_FIELDS, STAT_GROUPS } from "./statFields";
import shell from "./Overlay.module.css";
import styles from "./Stats.module.css";

// The ride numbers Zwift shows top centre - speed, distance, climbing, time -
// with the rider's level, how far through it and their Drops, and who's
// being watched, in The Ultra Cyclist's look. Level progress and Drops come
// from the rider's Zwift profile through the site (Sauce doesn't carry
// them); Zwift updates them when it saves the ride, every few minutes.

const DEFAULTS = { opacity: 80, fit: true, climb: false, climbWidth: "zwift", rideBar: true, rideLabel: "left", levelLabel: "toNext", fields: "", watching: true, level: true, drops: true, progress: true };
const DEFS: SettingDef[] = [
  { key: "fit", label: "Size to the window (drag a corner)", type: "toggle" },
  { key: "climb", label: "Climb pop-up under the stats", type: "toggle" },
  {
    key: "climbWidth",
    label: "Climb pop-up width",
    type: "select",
    options: [
      { value: "zwift", label: "Like Zwift's (narrower, centred)" },
      { value: "full", label: "Full width (covers the whole HUD)" },
    ],
  },
  { key: "rideBar", label: "Ride progress bar", type: "toggle" },
  {
    key: "rideLabel",
    label: "Ride bar label",
    type: "select",
    options: [
      { value: "none", label: "None" },
      { value: "left", label: "What's left (distance or time)" },
      { value: "done", label: "% done" },
      { value: "both", label: "Both" },
    ],
  },
  { key: "watching", label: "Who you're watching", type: "toggle" },
  { key: "level", label: "Level", type: "toggle" },
  { key: "progress", label: "Progress to the next level", type: "toggle" },
  {
    key: "levelLabel",
    label: "Level bar label",
    type: "select",
    options: [
      { value: "none", label: "None" },
      { value: "toNext", label: "% to the next level" },
      { value: "through", label: "% through this level" },
    ],
  },
  { key: "drops", label: "Drops", type: "toggle" },
];

/** The bar's own width, before scaling, with the climb pop-up under it - sets how tall it comes out. */
const CLIMB_BAR_WIDTH = 760;

const statById = new Map(STAT_FIELDS.map((f) => [f.id, f]));

/** The stats chosen, in their order - before there was a choice, from the old on/off settings. */
function chosenStats(settings: Record<string, unknown>): RiderField[] {
  let ids = String(settings.fields ?? "");
  if (!ids) ids = ["speed", "distance", "climbing", "time", "gradient"].filter((k) => settings[k] ?? k !== "gradient").join(",");
  return ids.split(",").map((id) => statById.get(id)).filter((f): f is RiderField => !!f);
}

interface Profile {
  configured?: boolean;
  level?: number;
  levelPct?: number;
  drops?: number;
  error?: string;
}

/** Asked for about once a minute: the site keeps it for that long, and Zwift updates it every few. */
const PROFILE_EVERY_MS = 60_000;

/**
 * Drops, counting up between the profile's updates. Zwift only updates the
 * profile's total now and then (when it saves the ride, at a level-up), so
 * in between the Drops earned are estimated from the energy ridden since
 * (Sauce's kJ, live) at the rider's own rate - learnt each time Zwift's real
 * figure moves, kept between rides - and corrected whenever it arrives.
 */
const DROPS_RATE_KEY = "drops:per-kj";
/** About what Zwift gives on the flat, before the rider's own rate has been learnt. */
const DEFAULT_DROPS_PER_KJ = 25;
const dropsState = { base: undefined as number | undefined, baseKj: undefined as number | undefined, rate: undefined as number | undefined };

function dropsRate(): number {
  if (dropsState.rate != null) return dropsState.rate;
  try {
    const v = Number(window.localStorage.getItem(DROPS_RATE_KEY));
    dropsState.rate = v > 0 ? v : DEFAULT_DROPS_PER_KJ;
  } catch {
    dropsState.rate = DEFAULT_DROPS_PER_KJ;
  }
  return dropsState.rate;
}

function liveDrops(real: number | undefined, kj: number | undefined): number | undefined {
  if (real == null) return undefined;
  if (kj == null) return real;
  if (dropsState.base !== real) {
    // Zwift's figure moved: learn the rate from what it gave for the energy ridden since the last one.
    if (dropsState.base != null && dropsState.baseKj != null && real > dropsState.base && kj - dropsState.baseKj >= 30) {
      const measured = (real - dropsState.base) / (kj - dropsState.baseKj);
      dropsState.rate = dropsRate() * 0.5 + measured * 0.5;
      try {
        window.localStorage.setItem(DROPS_RATE_KEY, String(Math.round(dropsState.rate * 10) / 10));
      } catch {
        // Not kept: learnt again next ride.
      }
    }
    dropsState.base = real;
    dropsState.baseKj = kj;
  }
  return Math.round(real + Math.max(0, kj - (dropsState.baseKj ?? kj)) * dropsRate());
}

/** The Climb pop-up overlay's own settings, so the pop-up here is set up the same way. */
function climbSettings(): ClimbSettings {
  try {
    const v = JSON.parse(window.localStorage.getItem("overlay:climb") ?? "{}") as Partial<ClimbSettings>;
    return { ...CLIMB_DEFAULTS, ...v };
  } catch {
    return CLIMB_DEFAULTS;
  }
}

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
  const chosen = chosenStats(settings as Record<string, unknown>);
  const stats = chosen.map((f) => ({
    id: f.id,
    value: watching ? display(f, watching) : "–",
    unit: f.unit ?? f.short,
    colour: watching ? colourOf(f, watching) : undefined,
  }));

  // How much of the ride is done: Zwift's own event progress in an event
  // (not in a workout, where it's the workout's), else ridden against to go.
  const st = s as { progress?: number; workoutZone?: number | null } | null | undefined;
  // A ride that counts down in time (a group ride's "11 min to go") goes by time ridden against time left.
  const toGo = watching?.remainingMetric === "distance" && watching.remaining != null ? watching.remaining : undefined;
  const timeToGo = watching?.remainingMetric === "time" && watching.remaining != null ? watching.remaining : undefined;
  const rideDone =
    s?.eventSubgroupId && st?.progress && !st.workoutZone
      ? Math.min(1, st.progress)
      : toGo != null && metres != null && metres + toGo > 0
        ? Math.min(1, metres / (metres + toGo))
        : timeToGo != null && s?.time != null && s.time + timeToGo > 0
          ? Math.min(1, s.time / (s.time + timeToGo))
          : undefined;

  // What's left, for the ride bar's label: the distance to go, or the time in a ride that counts down in time.
  const rideLeft =
    toGo != null ? `${toGo >= 1000 ? `${(toGo / 1000).toFixed(1)} km` : `${Math.round(toGo)} m`} to go` : timeToGo != null ? `${formatElapsed(timeToGo * 1000)} to go` : undefined;

  // Level, progress and Drops are the rider's own: shown while they're the one riding.
  const profile = useProfile(settings.level || settings.drops || settings.progress);
  const own = watching?.self !== false && profile?.configured !== false && !profile?.error ? profile : null;
  const watchingName = settings.watching && watching && !watching.self ? athleteName(watching) : undefined;
  const level = settings.level ? (own?.level ?? (watching?.self !== false ? watching?.athlete?.level : undefined)) : undefined;
  const pct = settings.progress ? own?.levelPct : undefined;
  const drops = settings.drops ? liveDrops(own?.drops, (s as { kj?: number } | null | undefined)?.kj) : undefined;

  // The climb pop-up, like Zwift's under its ride stats, when chosen - set up as the Climb pop-up overlay is.
  const { address } = useSauce({});
  const { route } = useCourse(address, settings.climb ? watching : null);
  const at = settings.climb && route ? routePosition(route, s) : undefined;
  const climbSet = settings.climb ? climbSettings() : CLIMB_DEFAULTS;
  const climb = useClimb(settings.climb ? route : null, at, climbSet, s?.grade != null ? s.grade * 100 : undefined);

  // Sized to the window: the bar drawn at its natural size, then scaled to
  // fill the window's width - so dragging the window's corner makes it as
  // big as Zwift's own ride stats, to sit over them. The bar alone sets the
  // size, so a climb pop-up appearing under it doesn't shrink it.
  const inner = useRef<HTMLDivElement | null>(null);
  const bar = useRef<HTMLDivElement | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  // Measured after every render (the bar changes with the settings) - only set when the size really changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (!settings.fit) {
      setScale(1);
      return;
    }
    const fit = () => {
      const el = bar.current ?? inner.current;
      const row = rowRef.current;
      if (!el || !el.offsetHeight) return;
      // Sized by the window's height (the bar's share of it, with room below
      // for a climb pop-up), then stretched across the window's full width -
      // so the window can be dragged as wide as Zwift's HUD. Never so big
      // that the numbers no longer fit across.
      // With the climb pop-up the window's height is mostly room for it, so
      // the bar is sized from the width alone, as Zwift's is to its screen.
      const minWidth = row ? Array.from(row.children).reduce((w, c) => w + (c as HTMLElement).offsetWidth, 0) + (row.children.length - 1) * 24 + 40 : 0;
      let next = settings.climb ? window.innerWidth / Math.max(minWidth, CLIMB_BAR_WIDTH) : window.innerHeight / el.offsetHeight;
      if (minWidth && window.innerWidth / next < minWidth) next = window.innerWidth / minWidth;
      next = Math.max(0.3, next);
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
    <OverlayShell
      title="Ride stats"
      settings={settings}
      setSetting={set}
      defs={DEFS}
      menuWidth={720}
      extraRows={20}
      extraSettings={
        <FieldPicker
          title="Stats in the bar (in order)"
          value={chosen.map((f) => f.id).join(",")}
          onChange={(v) => set("fields", v)}
          fields={STAT_FIELDS}
          groups={STAT_GROUPS}
          ordered
        />
      }
    >
      <div className={settings.fit ? styles.fitFrame : undefined}>
      <div
        ref={inner}
        className={`${styles.wrap} ${settings.fit ? styles.fitted : ""}`}
        style={settings.fit ? { transform: `scale(${scale})`, width: `${window.innerWidth / scale}px` } : undefined}
      >
        {stats.length > 0 && (
          <div ref={bar} className={`${shell.panel} ${styles.stats}`}>
            <div ref={rowRef} className={styles.row}>
              {stats.map((x) => (
                <span key={x.id} className={styles.stat}>
                  <span className={styles.value} style={{ color: x.colour }}>
                    {x.value}
                  </span>
                  {x.unit && <span className={styles.unit}>{x.unit}</span>}
                </span>
              ))}
            </div>
            {settings.rideBar && rideDone != null && settings.rideLabel !== "none" && (
              <div className={styles.barLabel}>
                <span>{settings.rideLabel !== "done" ? (rideLeft ?? `${Math.round(rideDone * 100)}% done`) : `${Math.round(rideDone * 100)}% done`}</span>
                {settings.rideLabel === "both" && rideLeft && <span>{Math.round(rideDone * 100)}% done</span>}
              </div>
            )}
            {settings.rideBar && rideDone != null && (
              <div className={`${styles.progress} ${styles.ride}`} title={`${Math.round(rideDone * 100)}% of the way`}>
                <span style={{ width: `${rideDone * 100}%` }} />
              </div>
            )}
            {pct != null && settings.levelLabel !== "none" && (
              <div className={styles.barLabel}>
                <span>{own?.level != null ? `Level ${own.level}` : "Level"}</span>
                <span>
                  {settings.levelLabel === "through"
                    ? `${Math.round(pct)}% through`
                    : `${Math.max(0, 100 - Math.round(pct))}% to ${own?.level != null ? `level ${own.level + 1}` : "the next level"}`}
                </span>
              </div>
            )}
            {pct != null && (
              <div className={styles.progress} title={`${pct}% of the way to level ${(level ?? 0) + 1}`}>
                <span style={{ width: `${pct}%` }} />
              </div>
            )}
            {(level != null || drops != null || watchingName) && (
              <div className={styles.badges}>
                {level != null ? (
                  <span className={styles.badge} title="Zwift level">
                    <span className={styles.badgeIcon}>🚲</span>
                    {level}
                  </span>
                ) : (
                  <span />
                )}
                {/* Who's being watched, in the bar itself - no strip between it and the climb pop-up. */}
                {watchingName && <span className={styles.watching}>Watching {watchingName}</span>}
                {drops != null ? (
                  <span className={`${styles.badge} ${styles.drops}`} title="Drops">
                    {drops.toLocaleString("en-GB")}
                    <span className={styles.badgeIcon}>💧</span>
                  </span>
                ) : (
                  <span />
                )}
              </div>
            )}
          </div>
        )}
        {settings.climb && climb && route && at != null && (
          <div className={`${styles.climb} ${settings.climbWidth === "full" ? styles.climbFull : ""}`}>
            <ClimbCard route={route} at={at} climb={climb} gradeNow={s?.grade != null ? s.grade * 100 : undefined} settings={climbSet} />
          </div>
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
