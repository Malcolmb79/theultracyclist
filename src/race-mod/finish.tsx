import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { loadEventBrief, loadResults } from "../components/race/eventInfo";
import type { RaceResult } from "../components/race/raceLog";
import { OverlayShell, useSettings, type SettingDef, Recover } from "./overlay";
import { useSauce } from "./useSauce";
import { useFlags } from "./flags";
import shell from "./Overlay.module.css";
import styles from "./Finish.module.css";

// The results as riders cross the line, the way a TV finish graphic builds
// them: gold, silver and bronze for the podium as they come in, then the
// minor places rounding it off, each with their time or gap to the winner.
// From Zwift's results for the race, through Sauce - they arrive a few
// seconds after each rider finishes.

const DEFAULTS = { opacity: 85, rows: 10, stayFor: 5, wkg: true, example: false };
const DEFS: SettingDef[] = [
  { key: "example", label: "Show an example (for placing it)", type: "toggle" },
  { key: "rows", label: "Places shown", type: "select", options: [5, 8, 10, 15, 20].map((n) => ({ value: n, label: String(n) })) },
  {
    key: "stayFor",
    label: "Stays up after you finish",
    type: "select",
    options: [
      { value: 2, label: "2 minutes" },
      { value: 5, label: "5 minutes" },
      { value: 10, label: "10 minutes" },
      { value: 0, label: "Until the next race" },
    ],
  },
  { key: "wkg", label: "Watts per kilo", type: "toggle" },
];

/** Asked for this often from a little before the line, as finishers trickle in. */
const POLL_MS = 5000;
/** Start asking this far from the finish (or once the rider is over it). */
const NEAR_FINISH_M = 3000;
const MEDALS = ["gold", "silver", "bronze"] as const;

const EXAMPLE: RaceResult[] = [
  { athleteId: 1, rank: 1, name: "Curtis Ames", timeMs: 1_812_400, avgWatts: 312, weightKg: 74 },
  { athleteId: 2, rank: 2, name: "Mike Scarborough", timeMs: 1_812_700, avgWatts: 298, weightKg: 71 },
  { athleteId: 3, rank: 3, name: "Robin Cauwenberghs", timeMs: 1_813_100, avgWatts: 289, weightKg: 74.5 },
  { athleteId: 4, rank: 4, name: "Derek Moore", timeMs: 1_815_900, avgWatts: 280, weightKg: 77 },
  { athleteId: 5, rank: 5, name: "Axel Annequin", timeMs: 1_821_300, avgWatts: 251, weightKg: 68 },
];

/** "30:12.4" for the winner. */
function clock(ms: number): string {
  const s = ms / 1000;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = (s % 60).toFixed(1).padStart(4, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** "+0.3s", "+1:04" behind the winner. */
function behind(ms: number): string {
  const s = ms / 1000;
  return s < 60 ? `+${s.toFixed(1)}s` : `+${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
}

function FinishOverlay() {
  const [settings, set] = useSettings("finish", DEFAULTS);
  const { address, watching, nearby } = useSauce({ nearby: true });
  const flags = useFlags(address);
  const subgroup = watching?.state?.eventSubgroupId || undefined;
  const [results, setResults] = useState<RaceResult[]>([]);
  const [title, setTitle] = useState<string | undefined>();
  // Countries, from riders seen on the road - the results don't carry them.
  const countries = useRef(new Map<number, number>());
  for (const r of nearby) if (r.athlete?.countryCode != null) countries.current.set(r.athleteId, r.athlete.countryCode);

  // A new race: start again.
  const finishedAt = useRef<number | null>(null);
  useEffect(() => {
    setResults([]);
    setTitle(undefined);
    finishedAt.current = null;
    if (!subgroup) return;
    void loadEventBrief(address, subgroup)
      .then((b) => setTitle([b?.name, b?.label].filter(Boolean).join(" · ")))
      .catch(() => undefined);
  }, [address, subgroup]);

  // Over the line: the event's distance (or time) has run out.
  const remaining = watching?.remainingType === "event" ? watching.remaining : undefined;
  const over = remaining != null && remaining <= 0;
  if (over && finishedAt.current == null) finishedAt.current = Date.now();
  const near = over || (remaining != null && watching?.remainingMetric === "distance" && remaining <= NEAR_FINISH_M) || results.length > 0;

  useEffect(() => {
    if (!subgroup || !near || settings.example) return;
    let live = true;
    const poll = () =>
      void loadResults(address, subgroup)
        .then((list) => live && list.length && setResults(list))
        .catch(() => undefined);
    poll();
    const t = setInterval(poll, POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [address, subgroup, near, settings.example]);

  // Re-render now and then so the "stays up" timer can end it.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, []);

  const list = settings.example ? EXAMPLE : results;
  const expired = !settings.example && settings.stayFor > 0 && finishedAt.current != null && Date.now() - finishedAt.current > settings.stayFor * 60_000;
  if (!list.length || expired) {
    return (
      <OverlayShell title="Finish results" settings={settings} setSetting={set} defs={DEFS}>
        <div className={styles.idle}>Results appear as riders cross the line · right-click for settings</div>
      </OverlayShell>
    );
  }

  const me = settings.example ? 3 : watching?.athleteId;
  const winner = list[0];
  const podium = list.slice(0, 3);
  const rest = list.slice(3, settings.rows);
  const mine = list.find((r) => r.athleteId === me);
  const mineBelow = mine && mine.rank > settings.rows ? mine : undefined;
  const wkg = (r: RaceResult) => (settings.wkg && r.avgWatts && r.weightKg ? `${(r.avgWatts / r.weightKg).toFixed(1)} W/kg` : undefined);
  const timeOf = (r: RaceResult) =>
    r.timeMs == null ? "" : r === winner || winner.timeMs == null ? clock(r.timeMs) : behind(r.timeMs - winner.timeMs);
  const flagOf = (r: RaceResult) => {
    const c = countries.current.get(r.athleteId);
    const f = c != null ? flags.get(c) : undefined;
    return f ? <img className={styles.flag} src={f.src} alt={f.name} title={f.name} /> : null;
  };

  const row = (r: RaceResult) => (
    <li key={r.athleteId} className={`${styles.row} ${r.athleteId === me ? styles.me : ""}`}>
      <span className={styles.rank}>{r.rank}</span>
      <span className={styles.name}>
        {flagOf(r)}
        {r.name}
      </span>
      {wkg(r) && <span className={styles.wkg}>{wkg(r)}</span>}
      <span className={styles.time}>{timeOf(r)}</span>
    </li>
  );

  return (
    <OverlayShell title="Finish results" settings={settings} setSetting={set} defs={DEFS}>
      <div className={`${shell.panel} ${styles.panel}`}>
        <header className={styles.head}>
          <span className={styles.title}>Results</span>
          <span className={styles.event}>
            {settings.example ? "Example" : title}
            {!settings.example && !over && " · still racing"}
          </span>
        </header>

        <ol className={styles.podium}>
          {podium.map((r, k) => (
            <li key={r.athleteId} className={`${styles.step} ${styles[MEDALS[k]]} ${r.athleteId === me ? styles.me : ""}`}>
              <span className={styles.medal}>{k + 1}</span>
              <span className={styles.who}>
                <span className={styles.podiumName}>
                  {flagOf(r)}
                  {r.name}
                </span>
                <span className={styles.detail}>
                  {timeOf(r)}
                  {wkg(r) && ` · ${wkg(r)}`}
                </span>
              </span>
            </li>
          ))}
        </ol>

        {rest.length > 0 && <ol className={styles.rest}>{rest.map(row)}</ol>}
        {mineBelow && (
          <ol className={styles.rest}>
            <li className={styles.more} aria-hidden>
              ⋮
            </li>
            {row(mineBelow)}
          </ol>
        )}
      </div>
    </OverlayShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Recover>
      <FinishOverlay />
    </Recover>
  </StrictMode>,
);
