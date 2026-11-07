import { StrictMode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { OverlayShell, useSettings, type SettingDef, Recover } from "./overlay";
import { useSauce } from "./useSauce";
import { drainPerSec, stamina, staminaFtp } from "./staminaModel";
import shell from "./Overlay.module.css";
import tool from "./Tool.module.css";

// Real-time stamina as Garmin shows it (see ./staminaModel): Potential, the
// long-term tank that only drains - faster the harder the effort, an hour
// at FTP - and Current, the short-term tank for hard efforts that drops in
// surges and refills when easing off. And, at the effort of the last
// minute, how long until Potential is empty. An estimate, labelled one.

const DEFAULTS = { opacity: 80, holdMin: 60, wbal: true, ftpSource: "site" };
const DEFS: SettingDef[] = [
  {
    key: "ftpSource",
    label: "FTP to measure against",
    type: "select",
    options: [
      { value: "site", label: "My FTP from the site (coaching settings)" },
      { value: "zwift", label: "Zwift's FTP" },
    ],
  },
  {
    key: "holdMin",
    label: "How long I can hold FTP",
    type: "select",
    options: [40, 50, 60, 70, 80, 90].map((m) => ({ value: m, label: `${m} min` })),
  },
  { key: "wbal", label: "Current stamina (short-term) as well", type: "toggle" },
];


/** Time to empty: "1h 05m", "14:32" under an hour, so it counts down. */
function countdown(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function StaminaOverlay() {
  const [settings, set] = useSettings("stamina", DEFAULTS);
  const { watching, status } = useSauce({});
  const minute = useRef<{ t: number; w: number }[]>([]);

  const s = watching?.state;
  const ftp = watching ? staminaFtp(watching, String(settings.ftpSource)) : undefined;

  // The last minute's power, for how long the effort now would last.
  useEffect(() => {
    if (s?.power == null) return;
    const now = Date.now();
    minute.current = [...minute.current, { t: now, w: s.power }].filter((x) => now - x.t <= 60_000);
  }, [watching]); // eslint-disable-line react-hooks/exhaustive-deps

  const recent = minute.current;
  const avgW = recent.length ? recent.reduce((a, x) => a + x.w, 0) / recent.length : undefined;
  const rate = avgW != null && ftp ? drainPerSec(avgW / ftp, settings.holdMin) : 0;
  const st = watching ? stamina(watching, { holdMin: settings.holdMin, ftpSource: String(settings.ftpSource) }) : undefined;
  const lasts = st && rate > 0 ? st.potential / rate : Infinity;
  const current = settings.wbal && st?.current != null ? Math.round(st.current) : null;
  const left = st ? Math.round(st.potential) : null;
  const colour = left == null ? "" : left > 50 ? tool.good : left > 20 ? tool.warn : tool.bad;

  return (
    <OverlayShell title="Stamina" settings={settings} setSetting={set} defs={DEFS}>
      <div className={`${shell.panel} ${tool.panel}`}>
        {!ftp ? (
          <p className={tool.waiting}>{status === "connected" ? "Needs the rider's FTP from Zwift." : "Connecting to Sauce…"}</p>
        ) : left == null ? (
          <p className={tool.waiting}>Waiting for the ride to start…</p>
        ) : (
          <>
            <div className={tool.top}>
              <span className={tool.label}>Potential stamina</span>
              {current != null && <span className={tool.tag} title="Current stamina: what's left for hard efforts now - drops in surges, refills when you ease off">Current {current}%</span>}
            </div>
            <div className={`${tool.big} ${colour}`}>
              {left}
              <small>%</small>
            </div>
            <div className={tool.bar} aria-hidden>
              <span style={{ width: `${left}%`, background: left > 50 ? undefined : left > 20 ? "var(--color-amber)" : "var(--color-accent)" }} />
            </div>
            <p className={tool.line}>
              {left <= 0
                ? "Empty - riding on reserves"
                : !Number.isFinite(lasts) || lasts > 6 * 3600
                  ? "At this effort: barely touching it"
                  : `At this effort: empty in ${countdown(lasts)}`}
            </p>
            <p className={`${tool.line} ${tool.muted}`}>
              An estimate, against {settings.ftpSource === "site" ? "your FTP" : "Zwift's FTP"} of {ftp} W.
            </p>
          </>
        )}
      </div>
    </OverlayShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Recover>
      <StaminaOverlay />
    </Recover>
  </StrictMode>,
);
