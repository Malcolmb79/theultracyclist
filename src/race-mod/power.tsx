import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { OverlayShell, useSettings, type SettingDef } from "./overlay";
import { useSauce } from "./useSauce";
import shell from "./Overlay.module.css";
import styles from "./Power.module.css";

// Power, the way Zwift shows it top left - watts, watts per kilo, cadence,
// heart rate - in The Ultra Cyclist's look, with a bar for the training zone.

const DEFAULTS = { opacity: 80, smoothing: 3, wkg: true, cadence: true, heartRate: true, zone: true, ftpPct: false };
const DEFS: SettingDef[] = [
  { key: "smoothing", label: "Smoothing", type: "select", options: [1, 3, 5, 10].map((s) => ({ value: s, label: s === 1 ? "None" : `${s}s` })) },
  { key: "wkg", label: "Watts per kilo", type: "toggle" },
  { key: "cadence", label: "Cadence", type: "toggle" },
  { key: "heartRate", label: "Heart rate", type: "toggle" },
  { key: "zone", label: "Zone bar", type: "toggle" },
  { key: "ftpPct", label: "% of FTP", type: "toggle" },
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
      </div>
    </OverlayShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PowerOverlay />
  </StrictMode>,
);
