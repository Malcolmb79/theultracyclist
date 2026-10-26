import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { OverlayShell, useSettings, type SettingDef } from "./overlay";
import { useSauce } from "./useSauce";
import shell from "./Overlay.module.css";
import tool from "./Tool.module.css";

// Real-time stamina, like a bike computer's: how much of the whole ride's
// worth of effort is left, not just the short-term W′ battery - and whether
// the effort of the last minute would last to the finish.
//
// An estimate, and labelled one: stamina drains with intensity to the
// fourth power, so riding at FTP empties it in about an hour (the time a
// rider can hold FTP), at three-quarters of FTP in about three, and easy
// riding barely touches it.

const DEFAULTS = { opacity: 80, holdMin: 60, wbal: true };
const DEFS: SettingDef[] = [
  {
    key: "holdMin",
    label: "How long I can hold FTP",
    type: "select",
    options: [40, 50, 60, 70].map((m) => ({ value: m, label: `${m} min` })),
  },
  { key: "wbal", label: "W′ battery as well", type: "toggle" },
];

const KEY = "stamina:session";
const MAX_STEP_S = 5;
const NEW_RIDE_MS = 30 * 60_000;
const DEFAULT_W_PRIME = 20_000;

interface Session {
  athleteId: number;
  at: number;
  /** 0-100. */
  left: number;
}

function load(id: number): Session | null {
  try {
    const s = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Session | null;
    return s && s.athleteId === id && Date.now() - s.at < NEW_RIDE_MS ? s : null;
  } catch {
    return null;
  }
}

function span(secs: number): string {
  if (!Number.isFinite(secs)) return "all day";
  const m = Math.round(secs / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m} min`;
}

function StaminaOverlay() {
  const [settings, set] = useSettings("stamina", DEFAULTS);
  const { watching, status } = useSauce({});
  const [session, setSession] = useState<Session | null>(null);
  const last = useRef<number | null>(null);
  const minute = useRef<{ t: number; w: number; v: number }[]>([]);

  const id = watching?.athleteId;
  const s = watching?.state;
  const ftp = watching?.athlete?.ftp ?? undefined;
  // Per second of riding, as a percentage, at an intensity (fraction of FTP).
  const drain = (intensity: number) => (100 / (settings.holdMin * 60)) * Math.max(0, intensity) ** 4;

  useEffect(() => {
    if (id == null || s?.power == null || !ftp) return;
    const now = Date.now();
    const step = last.current ? (now - last.current) / 1000 : 0;
    last.current = now;
    minute.current = [...minute.current, { t: now, w: s.power, v: s.speed ?? 0 }].filter((x) => now - x.t <= 60_000);
    setSession((prev) => {
      const base = prev && prev.athleteId === id ? prev : (load(id) ?? { athleteId: id, at: now, left: 100 });
      if (step <= 0 || step > MAX_STEP_S) return { ...base, at: now };
      const next = { ...base, at: now, left: Math.max(0, base.left - drain(s.power! / ftp) * step) };
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // Unavailable - it starts again on a reload.
      }
      return next;
    });
    // Each update is a second ridden.
  }, [watching, id, s?.power, ftp]); // eslint-disable-line react-hooks/exhaustive-deps

  const recent = minute.current;
  const avgW = recent.length ? recent.reduce((a, x) => a + x.w, 0) / recent.length : undefined;
  const avgKmh = recent.length ? recent.reduce((a, x) => a + x.v, 0) / recent.length : undefined;
  const rate = avgW != null && ftp ? drain(avgW / ftp) : 0;
  const lasts = session && rate > 0 ? session.left / rate : Infinity;
  // The finish, in seconds at the speed of the last minute.
  const toFinish =
    watching?.remaining == null || watching.remaining <= 0
      ? undefined
      : watching.remainingMetric === "time"
        ? watching.remaining
        : avgKmh && avgKmh > 5
          ? watching.remaining / (avgKmh / 3.6)
          : undefined;
  const short = toFinish != null && lasts < toFinish ? toFinish - lasts : 0;
  const wbal = settings.wbal && watching?.wBal != null ? Math.round((watching.wBal / (watching.athlete?.wPrime || DEFAULT_W_PRIME)) * 100) : null;
  const left = session ? Math.round(session.left) : null;
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
              {toFinish == null
                ? `At this effort: lasts ${span(lasts)}`
                : short > 0
                  ? `At this effort: empty ${span(short)} before the finish`
                  : "At this effort: lasts to the finish"}
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
