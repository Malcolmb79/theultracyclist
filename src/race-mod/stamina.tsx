import { StrictMode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { OverlayShell, useSettings, type SettingDef } from "./overlay";
import { useSauce } from "./useSauce";
import { staminaLeft } from "./riderFields";
import shell from "./Overlay.module.css";
import tool from "./Tool.module.css";

// Real-time stamina, like a bike computer's: how much of the whole ride's
// worth of effort is left, not just the short-term W′ battery - and, at the
// effort of the last minute, how long until it's empty.
//
// An estimate, and labelled one: stamina drains with intensity to the
// fourth power, so riding at FTP empties it in about an hour (the time a
// rider can hold FTP), at three-quarters of FTP in about three, and easy
// riding barely touches it. Worked out from the ride's normalised power -
// the same fourth-power average - exactly as the rider cards do, so the two
// always agree, and short spikes don't count more than they should.

const DEFAULTS = { opacity: 80, holdMin: 60, wbal: true };
const DEFS: SettingDef[] = [
  {
    key: "holdMin",
    label: "How long I can hold FTP",
    type: "select",
    options: [40, 50, 60, 70, 80, 90].map((m) => ({ value: m, label: `${m} min` })),
  },
  { key: "wbal", label: "W′ battery as well", type: "toggle" },
];

const DEFAULT_W_PRIME = 20_000;

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
  const ftp = watching?.athlete?.ftp ?? undefined;
  // Per second of riding, as a percentage, at an intensity (fraction of FTP).
  const drain = (intensity: number) => (100 / (settings.holdMin * 60)) * Math.max(0, intensity) ** 4;

  // The last minute's power, for how long the effort now would last.
  useEffect(() => {
    if (s?.power == null) return;
    const now = Date.now();
    minute.current = [...minute.current, { t: now, w: s.power }].filter((x) => now - x.t <= 60_000);
  }, [watching]); // eslint-disable-line react-hooks/exhaustive-deps

  const recent = minute.current;
  const avgW = recent.length ? recent.reduce((a, x) => a + x.w, 0) / recent.length : undefined;
  const rate = avgW != null && ftp ? drain(avgW / ftp) : 0;
  const leftExact = watching ? staminaLeft(watching, settings.holdMin) : undefined;
  const lasts = leftExact != null && rate > 0 ? leftExact / rate : Infinity;
  const wbal = settings.wbal && watching?.wBal != null ? Math.round((watching.wBal / (watching.athlete?.wPrime || DEFAULT_W_PRIME)) * 100) : null;
  const left = leftExact != null ? Math.round(leftExact) : null;
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
              <span className={tool.label}>Stamina</span>
              {wbal != null && <span className={tool.tag}>W′ {wbal}%</span>}
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
            <p className={`${tool.line} ${tool.muted}`}>An estimate, from effort against FTP.</p>
          </>
        )}
      </div>
    </OverlayShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StaminaOverlay />
  </StrictMode>,
);
