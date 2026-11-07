import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { OverlayShell, useSettings, type SettingDef } from "./overlay";
import { SITE } from "./site";
import shell from "./Overlay.module.css";
import styles from "./Signups.module.css";

// Which races a cyclist has signed up for in the next 24 hours: search by
// name or Zwift id. Zwift can't be asked for a rider's sign-ups directly,
// so the site looks through every race starting in the next day
// (api/_routes/zwift-signups.ts) a batch at a time - this window asks again
// until it's done, showing what's found as it goes.

const DEFAULTS = { opacity: 90, query: "" };
const DEFS: SettingDef[] = [];

interface Match {
  eventId: number;
  event: string;
  start: number;
  category: string;
  signedUp: number;
  laps?: number;
  distanceKm?: number;
  rider: { id: number; name: string };
}

interface Answer {
  configured?: boolean;
  total?: number;
  checked?: number;
  done?: boolean;
  matches?: Match[];
  error?: string;
}

function raceKey(): string | null {
  try {
    const raw = window.localStorage.getItem("race:commentary-key");
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return typeof v === "string" && v ? v : null;
  } catch {
    return null;
  }
}

function when(at: number, now: number): { day: string; time: string; inText: string } {
  const d = new Date(at);
  const today = new Date(now);
  const tomorrow = new Date(now + 86_400_000);
  const day = d.toDateString() === today.toDateString() ? "Today" : d.toDateString() === tomorrow.toDateString() ? "Tomorrow" : d.toLocaleDateString("en-GB", { weekday: "short" });
  const mins = Math.round((at - now) / 60_000);
  const inText = mins <= 0 ? "started" : mins < 60 ? `in ${mins} min` : `in ${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
  return { day, time: d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }), inText };
}

function SignupsOverlay() {
  const [settings, set] = useSettings("signups", DEFAULTS);
  const [text, setText] = useState(String(settings.query ?? ""));
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [note, setNote] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  // Asked again until the sweep is done - or stops getting further (a race Zwift won't answer for).
  const run = useRef(0);
  useEffect(() => {
    if (!query) return;
    const key = raceKey();
    if (!key) {
      setNote("Set your race key in the Race console window first - the search runs through the site");
      return;
    }
    const mine = ++run.current;
    let stuck = 0;
    let last = -1;
    setBusy(true);
    setNote(undefined);
    setAnswer(null);
    const ask = async () => {
      try {
        const res = await fetch(`${SITE}/api/zwift-signups?q=${encodeURIComponent(query)}`, { headers: { authorization: `Bearer ${key}` }, credentials: "omit" });
        const a = (await res.json().catch(() => ({}))) as Answer;
        if (run.current !== mine) return;
        if (res.status === 401) return (setNote("The site didn't accept the race key - set it again in the Race console"), setBusy(false));
        if (a.configured === false) return (setNote("Zwift isn't set up on the site (ZWIFT_USERNAME / ZWIFT_PASSWORD in Vercel)"), setBusy(false));
        if (!res.ok) return (setNote(a.error ?? "The search failed - try again"), setBusy(false));
        setAnswer(a);
        stuck = (a.checked ?? 0) === last ? stuck + 1 : 0;
        last = a.checked ?? 0;
        if (!a.done && stuck < 4) setTimeout(() => void ask(), 1200);
        else setBusy(false);
      } catch {
        if (run.current !== mine) return;
        setNote("Can't reach the site - try again");
        setBusy(false);
      }
    };
    void ask();
  }, [query]);

  const search = () => {
    const q = text.trim();
    if (!q) return;
    set("query", q);
    // The same search again starts it again.
    setQuery("");
    setTimeout(() => setQuery(q), 0);
  };

  const now = Date.now();
  const matches = (answer?.matches ?? []).slice().sort((a, b) => a.start - b.start);
  const riders = new Set(matches.map((m) => m.rider.id));
  const pct = answer?.total ? Math.round(((answer.checked ?? 0) / answer.total) * 100) : 0;

  return (
    <OverlayShell title="Sign-up search" settings={settings} setSetting={set} defs={DEFS}>
      <div className={`${shell.panel} ${styles.panel}`}>
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            search();
          }}
        >
          <input
            className={styles.input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Rider's name or Zwift id"
            aria-label="Rider's name or Zwift id"
          />
          <button type="submit" className={styles.button} disabled={!text.trim()}>
            Search
          </button>
        </form>
        <p className={styles.scope}>Races starting in the next 24 hours</p>

        {note && <p className={styles.note}>{note}</p>}

        {answer && (
          <div className={styles.progress} title={`${answer.checked ?? 0} of ${answer.total ?? 0} races looked through`}>
            <span className={styles.progressText}>
              {answer.done
                ? `All ${answer.total} races looked through`
                : busy
                  ? `Looking through races… ${answer.checked ?? 0} of ${answer.total ?? 0}`
                  : `${answer.checked ?? 0} of ${answer.total ?? 0} races looked through - Zwift didn't answer for the rest`}
            </span>
            {!answer.done && (
              <span className={styles.bar}>
                <span style={{ width: `${pct}%` }} />
              </span>
            )}
          </div>
        )}

        {answer && (
          <ol className={styles.list}>
            {matches.map((m) => {
              const w = when(m.start, now);
              return (
                <li key={`${m.eventId}-${m.category}-${m.rider.id}`} className={styles.item}>
                  <span className={styles.when}>
                    <b>{w.time}</b>
                    <small>{w.day}</small>
                  </span>
                  <span className={styles.what}>
                    <span className={styles.event}>
                      {m.category && <span className={`${styles.cat} ${styles[`cat${m.category}`] ?? ""}`}>{m.category}</span>}
                      {m.event}
                    </span>
                    <span className={styles.meta}>
                      {w.inText}
                      {m.distanceKm ? ` · ${m.distanceKm} km` : ""}
                      {m.laps && m.laps > 1 ? ` · ${m.laps} laps` : ""}
                      {` · ${m.signedUp} signed up`}
                      {riders.size > 1 ? ` · ${m.rider.name}` : ""}
                    </span>
                  </span>
                </li>
              );
            })}
            {!matches.length && answer.done && <li className={styles.none}>No sign-ups found for “{query}” in the next 24 hours.</li>}
            {!matches.length && !answer.done && busy && <li className={styles.none}>Nothing yet…</li>}
          </ol>
        )}
        {riders.size > 1 && <p className={styles.scope}>{riders.size} riders match - add more of the name, or use their Zwift id.</p>}
      </div>
    </OverlayShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SignupsOverlay />
  </StrictMode>,
);
