import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { OverlayShell, useSettings, type SettingDef } from "./overlay";
import { useSauce } from "./useSauce";
import shell from "./Overlay.module.css";
import styles from "./Power.module.css";

// Power, the way Zwift shows it top left - watts, watts per kilo, cadence,
// heart rate - in The Ultra Cyclist's look, with a bar for the training zone
// and how long has been spent in each zone this race (or ride), and the W′
// battery: how much of the anaerobic tank is left.

const DEFAULTS = { opacity: 80, smoothing: 3, wkg: true, cadence: true, heartRate: true, zone: true, ftpPct: false, wbal: true, zoneTime: "bar" };
const DEFS: SettingDef[] = [
  { key: "smoothing", label: "Smoothing", type: "select", options: [1, 3, 5, 10].map((s) => ({ value: s, label: s === 1 ? "None" : `${s}s` })) },
  { key: "wkg", label: "Watts per kilo", type: "toggle" },
  { key: "cadence", label: "Cadence", type: "toggle" },
  { key: "heartRate", label: "Heart rate", type: "toggle" },
  { key: "zone", label: "Zone bar", type: "toggle" },
  { key: "ftpPct", label: "% of FTP", type: "toggle" },
  { key: "wbal", label: "W′ battery", type: "toggle" },
  {
    key: "zoneTime",
    label: "Time in zone",
    type: "select",
    options: [
      { value: "bar", label: "Bar" },
      { value: "list", label: "Zone by zone" },
      { value: "off", label: "Off" },
    ],
  },
];

/** Coggan power zones, as a share of FTP, with the colour Zwift uses for each. */
const ZONES = [
  { upTo: 0.6, name: "Z1", color: "#9aa4ae" },
  { upTo: 0.76, name: "Z2", color: "#3b82f6" },
  { upTo: 0.9, name: "Z3", color: "#2ee6a6" },
  { upTo: 1.05, name: "Z4", color: "#ffd23f" },
  { upTo: 1.18, name: "Z5", color: "#ff9a2e" },
  { upTo: Infinity, name: "Z6", color: "#ff4d2e" },
];

/** Sauce's own assumption when a rider's profile has no W′. */
const DEFAULT_W_PRIME = 20_000;

/** The W′ tank as a battery: full when fresh, draining as the rider goes over FTP. */
function WbalBattery({ wBal, wPrime }: { wBal: number; wPrime: number }) {
  const share = Math.max(0, Math.min(1, wBal / wPrime));
  const color = share > 0.5 ? "var(--color-accent-2)" : share > 0.25 ? "var(--color-amber)" : "var(--color-accent)";
  return (
    <div className={styles.wbal} title={`W′ balance ${(wBal / 1000).toFixed(1)} of ${(wPrime / 1000).toFixed(1)} kJ`}>
      <span className={styles.battery} aria-hidden>
        <span className={`${styles.charge} ${share <= 0.25 ? styles.low : ""}`} style={{ width: `${share * 100}%`, background: color }} />
      </span>
      <span className={styles.wbalText}>
        <b style={{ color }}>{Math.round(share * 100)}%</b> W′ · {(wBal / 1000).toFixed(1)} kJ
      </span>
    </div>
  );
}

const ZONE_TIME_KEY = "power:zone-time";
/** A gap in updates longer than this isn't counted (Zwift paused, Sauce reconnecting). */
const MAX_STEP_S = 5;
/** Coming back to the same rider and event after this long starts the count again. */
const STALE_MS = 30 * 60_000;

interface ZoneTime {
  key: string;
  at: number;
  secs: number[];
}

function loadZoneTime(): ZoneTime | null {
  try {
    const v = JSON.parse(window.localStorage.getItem(ZONE_TIME_KEY) ?? "null") as ZoneTime | null;
    return v && Array.isArray(v.secs) && v.secs.length === ZONES.length ? v : null;
  } catch {
    return null;
  }
}

function clock(secs: number): string {
  const s = Math.round(secs);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Seconds in each zone for the watched rider, in this event (or this ride,
 * outside one), from their power each second. Kept in storage so reopening
 * the window carries on the count; a new rider, a new event or a long break
 * starts it again.
 */
function useZoneTime(power: number | undefined, ftp: number | undefined, key: string | undefined, tick: unknown): number[] {
  const [secs, setSecs] = useState<number[]>(() => {
    const saved = loadZoneTime();
    return saved && saved.key === key && Date.now() - saved.at < STALE_MS ? saved.secs : ZONES.map(() => 0);
  });
  const last = useRef<{ key?: string; at: number } | null>(null);
  useEffect(() => {
    if (!key || power == null || !ftp) return;
    const now = Date.now();
    const prev = last.current;
    last.current = { key, at: now };
    setSecs((current) => {
      let base = current;
      if (!prev || prev.key !== key) {
        const saved = loadZoneTime();
        base = saved && saved.key === key && now - saved.at < STALE_MS ? saved.secs : ZONES.map(() => 0);
      }
      const step = prev && prev.key === key ? (now - prev.at) / 1000 : 0;
      if (step <= 0 || step > MAX_STEP_S || power <= 0) return base;
      const z = ZONES.findIndex((zone) => power / ftp <= zone.upTo);
      const next = base.map((v, i) => (i === z ? v + step : v));
      try {
        window.localStorage.setItem(ZONE_TIME_KEY, JSON.stringify({ key, at: now, secs: next } satisfies ZoneTime));
      } catch {
        // Full or unavailable - the count just won't survive a reload.
      }
      return next;
    });
    // Every update is a second ridden, not just a change in watts.
  }, [tick, power, ftp, key]);
  return secs;
}

function ZoneTimes({ secs, style }: { secs: number[]; style: string }) {
  const total = secs.reduce((a, b) => a + b, 0);
  if (total < 1) return null;
  if (style === "list") {
    const most = Math.max(...secs);
    return (
      <div className={styles.zoneList}>
        {ZONES.map((z, i) => (
          <div key={z.name} className={styles.zoneLine}>
            <span className={styles.zoneLabel} style={{ color: z.color }}>
              {z.name}
            </span>
            <span className={styles.zoneTrack}>
              <span style={{ width: `${(secs[i] / most) * 100}%`, background: z.color }} />
            </span>
            <span className={styles.zoneClock}>{clock(secs[i])}</span>
            <span className={styles.zonePct}>{Math.round((secs[i] / total) * 100)}%</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className={styles.zoneTime}>
      <div className={styles.stack} aria-hidden>
        {ZONES.map((z, i) => (secs[i] > 0 ? <span key={z.name} style={{ flex: secs[i], background: z.color }} /> : null))}
      </div>
      <div className={styles.stackLabels}>
        {ZONES.map((z, i) =>
          secs[i] >= 1 ? (
            <span key={z.name}>
              <b style={{ color: z.color }}>{z.name}</b> {clock(secs[i])}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}

function PowerOverlay() {
  const [settings, set] = useSettings("power", DEFAULTS);
  const { watching } = useSauce({});
  const history = useRef<{ at: number; w: number }[]>([]);
  const [smoothed, setSmoothed] = useState<number | null>(null);
  const s = watching?.state;

  // Watts averaged over the chosen window, the way Zwift's "3s power" works.
  useEffect(() => {
    if (s?.power == null) return;
    const now = Date.now();
    history.current = [...history.current, { at: now, w: s.power }].filter((x) => now - x.at < 10_000);
    const recent = history.current.filter((x) => now - x.at < settings.smoothing * 1000);
    setSmoothed(Math.round(recent.reduce((a, x) => a + x.w, 0) / recent.length));
    // Every update counts, not just a change in watts.
  }, [watching, s?.power, settings.smoothing]);

  const weight = watching?.athlete?.weight;
  const ftp = watching?.athlete?.ftp ?? undefined;
  const ratio = smoothed != null && ftp ? smoothed / ftp : undefined;
  const zone = ratio != null ? ZONES.find((z) => ratio <= z.upTo) : undefined;
  const zoneKey = watching ? `${watching.athleteId}:${s?.eventSubgroupId ?? "ride"}` : undefined;
  const zoneSecs = useZoneTime(s?.power, ftp, zoneKey, watching);

  return (
    <OverlayShell title="Power" settings={settings} setSetting={set} defs={DEFS}>
      <div className={`${shell.panel} ${styles.panel}`}>
        <div className={styles.main}>
          <span className={styles.watts}>{smoothed ?? "–"}</span>
          <span className={styles.unit}>W</span>
          {settings.wkg && smoothed != null && weight ? (
            <span className={styles.wkg}>
              {(smoothed / weight).toFixed(1)}
              <small>W/kg</small>
            </span>
          ) : null}
        </div>
        {settings.zone && (
          <div className={styles.zoneBar} aria-hidden>
            <div
              className={styles.zoneFill}
              style={{ width: `${Math.min(100, ((ratio ?? 0) / 1.5) * 100)}%`, background: zone?.color ?? "var(--color-text-muted)" }}
            />
            {zone && <span className={styles.zoneName}>{zone.name}</span>}
          </div>
        )}
        <div className={styles.row}>
          {settings.cadence && (
            <span>
              <b>{s?.cadence ?? "–"}</b> rpm
            </span>
          )}
          {settings.heartRate && (
            <span className={styles.hr}>
              <b>{s?.heartrate || "–"}</b> bpm
            </span>
          )}
          {settings.ftpPct && ratio != null && (
            <span>
              <b>{Math.round(ratio * 100)}</b>% FTP
            </span>
          )}
        </div>
        {settings.wbal && watching?.wBal != null && (
          <WbalBattery wBal={watching.wBal} wPrime={watching.athlete?.wPrime || DEFAULT_W_PRIME} />
        )}
        {settings.zoneTime !== "off" && <ZoneTimes secs={zoneSecs} style={settings.zoneTime} />}
      </div>
    </OverlayShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PowerOverlay />
  </StrictMode>,
);
