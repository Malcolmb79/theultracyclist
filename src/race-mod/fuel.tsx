import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { OverlayShell, useSettings, type SettingDef } from "./overlay";
import { useSauce } from "./useSauce";
import shell from "./Overlay.module.css";
import tool from "./Tool.module.css";

// A fuelling assistant: the energy the ride has burned and roughly how much
// of it came from carbohydrate, and a reminder to eat and drink on a timer
// - with how much, from the effort - like a bike computer's fuelling alerts.
//
// The numbers are estimates: work done on the pedals (kJ) is close to the
// calories burned, at the body's ~24% efficiency, and the share from carbs
// rises with intensity. The reminder is acknowledged with a tap.

const DEFAULTS = { opacity: 80, every: 20, carbsPerHour: 75, voice: false };
const DEFS: SettingDef[] = [
  { key: "every", label: "Remind me every", type: "select", options: [15, 20, 30, 45].map((m) => ({ value: m, label: `${m} min` })) },
  { key: "carbsPerHour", label: "Carbs to take in", type: "select", options: [45, 60, 75, 90, 105].map((g) => ({ value: g, label: `${g} g an hour` })) },
  { key: "voice", label: "Say the reminder", type: "toggle" },
];

const KEY = "fuel:session";
/** A gap in updates longer than this isn't ridden time (paused, reconnecting). */
const MAX_STEP_S = 5;
/** Coming back after this long is a new ride. */
const NEW_RIDE_MS = 30 * 60_000;

interface Session {
  athleteId: number;
  at: number;
  kj: number;
  carbsG: number;
  secs: number;
  lastFedSecs: number;
}

/** Share of the energy that comes from carbohydrate, by intensity (fraction of FTP). */
function carbShare(intensity: number): number {
  if (intensity < 0.55) return 0.45;
  if (intensity < 0.75) return 0.45 + ((intensity - 0.55) / 0.2) * 0.2;
  if (intensity < 0.9) return 0.65 + ((intensity - 0.75) / 0.15) * 0.2;
  return Math.min(1, 0.85 + (intensity - 0.9) * 1.5);
}

function load(id: number): Session | null {
  try {
    const s = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Session | null;
    return s && s.athleteId === id && Date.now() - s.at < NEW_RIDE_MS ? s : null;
  } catch {
    return null;
  }
}

function clock(secs: number): string {
  const m = Math.floor(secs / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m} min`;
}

function FuelOverlay() {
  const [settings, set] = useSettings("fuel", DEFAULTS);
  const { watching, status } = useSauce({});
  const [session, setSession] = useState<Session | null>(null);
  const last = useRef<number | null>(null);
  const spoken = useRef(-1);

  const id = watching?.athleteId;
  const power = watching?.state?.power;
  const ftp = watching?.athlete?.ftp ?? undefined;

  // Every update: the energy since the last one.
  useEffect(() => {
    if (id == null || power == null) return;
    const now = Date.now();
    const step = last.current ? (now - last.current) / 1000 : 0;
    last.current = now;
    setSession((prev) => {
      const base = prev && prev.athleteId === id ? prev : (load(id) ?? { athleteId: id, at: now, kj: 0, carbsG: 0, secs: 0, lastFedSecs: 0 });
      if (step <= 0 || step > MAX_STEP_S || power <= 0) return { ...base, at: now };
      const kj = (power * step) / 1000;
      // Pedal work in kJ is about the kcal burned; 4 kcal to a gram of carbohydrate.
      const carbs = (kj * carbShare(ftp ? power / ftp : 0.7)) / 4;
      const next = { ...base, at: now, kj: base.kj + kj, carbsG: base.carbsG + carbs, secs: base.secs + step };
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // Unavailable - the count just won't survive a reload.
      }
      return next;
    });
  }, [watching, id, power, ftp]);

  const due = session ? session.secs - session.lastFedSecs >= settings.every * 60 : false;
  const grams = Math.round((settings.carbsPerHour * settings.every) / 60);
  // Say it once each time it comes due.
  useEffect(() => {
    if (!due || !settings.voice || !session || spoken.current === session.lastFedSecs) return;
    spoken.current = session.lastFedSecs;
    try {
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(`Time to eat. About ${grams} grams of carbs, and a drink.`));
    } catch {
      // No voice here - the panel still shows it.
    }
  }, [due, settings.voice, session, grams]);

  const fed = () =>
    setSession((s) => {
      if (!s) return s;
      const next = { ...s, lastFedSecs: s.secs };
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // As above.
      }
      return next;
    });
  const nextIn = session ? Math.max(0, settings.every * 60 - (session.secs - session.lastFedSecs)) : 0;
  const perHour = session && session.secs > 300 ? Math.round((session.carbsG / session.secs) * 3600) : null;

  return (
    <OverlayShell title="Fuelling" settings={settings} setSetting={set} defs={DEFS}>
      <div className={`${shell.panel} ${tool.panel}`} style={due ? { borderLeftColor: "var(--color-amber)" } : undefined}>
        {!session ? (
          <p className={tool.waiting}>{status === "connected" ? "Waiting for the ride to start…" : "Connecting to Sauce…"}</p>
        ) : (
          <>
            <div className={tool.top}>
              <span className={tool.label}>Fuel</span>
              <span className={tool.tag}>{clock(session.secs)} ridden</span>
            </div>
            {due ? (
              <>
                <div className={`${tool.big} ${tool.warn}`}>Eat now</div>
                <p className={tool.line}>About {grams} g of carbs, and a drink.</p>
                <button type="button" className={tool.button} onClick={fed}>
                  Done
                </button>
              </>
            ) : (
              <>
                <div className={tool.big}>
                  {Math.round(session.kj)}
                  <small>kJ</small>
                </div>
                <p className={tool.line}>
                  ~{Math.round(session.carbsG)} g carbs used{perHour != null ? ` · ${perHour} g an hour` : ""}
                </p>
                <p className={`${tool.line} ${tool.muted}`}>Next fuel in {clock(nextIn)}</p>
              </>
            )}
          </>
        )}
      </div>
    </OverlayShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <FuelOverlay />
  </StrictMode>,
);
