import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { athleteName, type SauceAthleteData } from "../components/race/sauceFeed";
import { inRace } from "../components/race/sameRace";
import { fetchRiderHistory } from "../components/race/commentary";
import type { RiderHistory } from "../components/race/raceLog";
import { OverlayShell, useSettings, type SettingDef } from "./overlay";
import { useSauce } from "./useSauce";
import { routePosition, useCourse } from "./useCourse";
import { useFlags } from "./flags";
import { predict, readFinish, type Chance, type FinishKind } from "./predictor";
import { SITE } from "./site";
import shell from "./Overlay.module.css";
import styles from "./Predict.module.css";

// Who's most likely to win the race, updated as it goes (predictor.ts for
// how): the favourites with their chances and why, the finish it's
// reckoned on, and the rider's own chance wherever they stand.

const DEFAULTS = { opacity: 85, rows: 6, why: true, zwiftPower: true };
const DEFS: SettingDef[] = [
  { key: "rows", label: "Riders listed", type: "select", options: [3, 5, 6, 8, 10].map((n) => ({ value: n, label: String(n) })) },
  { key: "why", label: "Why", type: "toggle" },
  { key: "zwiftPower", label: "Use riders' recent races (ZwiftPower)", type: "toggle" },
];

const FINISH: Record<FinishKind, string> = {
  sprint: "Flat sprint finish",
  punchy: "Punchy finish",
  climb: "Summit finish",
  unknown: "Finish unknown",
};

/** Chances eased from one update to the next, so the order doesn't flicker. */
const EASE = 0.3;
/** ZwiftPower: the leading riders, a few at a time, as the commentary does. */
const LOOKUP_TOP = 12;
const LOOKUP_BATCH = 6;
const LOOKUP_EVERY_MS = 20_000;

function raceKey(): string | null {
  try {
    const raw = window.localStorage.getItem("race:commentary-key");
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return typeof v === "string" && v ? v : null;
  } catch {
    return null;
  }
}

function PredictOverlay() {
  const [settings, set] = useSettings("predict", DEFAULTS);
  const { address, status, watching, nearby } = useSauce({ nearby: true });
  const { route } = useCourse(address, watching);
  const flags = useFlags(address);
  const subgroup = watching?.state?.eventSubgroupId || undefined;

  // ZwiftPower histories, looked up for the leading riders and kept for the race.
  const zp = useRef(new Map<number, RiderHistory | null>());
  const [, bump] = useState(0);
  const leaders = useRef<number[]>([]);
  useEffect(() => {
    if (!settings.zwiftPower || !subgroup) return;
    const key = raceKey();
    if (!key) return;
    let live = true;
    const look = () => {
      const ids = leaders.current.filter((id) => !zp.current.has(id)).slice(0, LOOKUP_BATCH);
      if (!ids.length) return;
      void fetchRiderHistory(SITE, key, ids)
        .then(({ riders }) => {
          if (!live) return;
          for (const id of ids) zp.current.set(id, riders[String(id)] ?? null);
          bump((n) => n + 1);
        })
        .catch(() => undefined);
    };
    const t = setInterval(look, LOOKUP_EVERY_MS);
    setTimeout(look, 3000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [settings.zwiftPower, subgroup]);

  const riders: SauceAthleteData[] = subgroup ? nearby.filter((r) => inRace(r, subgroup)) : [];
  const at = route ? routePosition(route, watching?.state) : undefined;
  const remainingM =
    watching?.remainingMetric === "distance"
      ? (watching.remaining ?? undefined)
      : watching?.remaining != null && watching.state?.speed
        ? watching.remaining * (watching.state.speed / 3.6)
        : undefined;
  const finish = readFinish(watching?.remainingMetric === "distance" ? route : null, at, remainingM);

  // The chances, eased between updates.
  const eased = useRef(new Map<number, number>());
  const [chances, setChances] = useState<Chance[]>([]);
  useEffect(() => {
    if (!riders.length) return;
    const raw = predict(riders, finish, zp.current);
    const next = raw.map((c) => {
      const was = eased.current.get(c.athleteId);
      const chance = was == null ? c.chance : was + (c.chance - was) * EASE;
      eased.current.set(c.athleteId, chance);
      return { ...c, chance };
    });
    const total = next.reduce((a, c) => a + c.chance, 0) || 1;
    setChances(next.map((c) => ({ ...c, chance: c.chance / total })).sort((a, b) => b.chance - a.chance));
    leaders.current = raw.slice(0, LOOKUP_TOP).map((c) => c.athleteId);
    // Each Sauce update.
  }, [nearby]); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = new Map(riders.map((r) => [r.athleteId, r]));
  const listed = chances.filter((c) => byId.has(c.athleteId));
  const top = listed.slice(0, settings.rows);
  const meIndex = listed.findIndex((c) => byId.get(c.athleteId)?.watching);
  const me = meIndex >= settings.rows ? listed[meIndex] : undefined;
  const leader = top[0]?.chance ?? 1;

  const row = (c: Chance, place: number) => {
    const r = byId.get(c.athleteId)!;
    const flag = r.athlete?.countryCode != null ? flags.get(r.athlete.countryCode) : undefined;
    const team = r.athlete?.team?.trim();
    return (
      <li key={c.athleteId} className={`${styles.row} ${r.watching ? styles.me : ""}`}>
        <span className={styles.place}>{place}</span>
        <span className={styles.who}>
          <span className={styles.name}>
            {flag && <img className={styles.flag} src={flag.src} alt={flag.name} title={flag.name} />}
            {athleteName(r)}
            {team && <span className={styles.team}>{team}</span>}
          </span>
          {settings.why && c.why.length > 0 && <span className={styles.why}>{c.why.slice(0, 3).join(" · ")}</span>}
          <span className={styles.bar} aria-hidden>
            <span style={{ width: `${(c.chance / leader) * 100}%` }} />
          </span>
        </span>
        <span className={styles.pct}>
          {c.chance >= 0.995 ? "99" : c.chance < 0.01 ? "<1" : Math.round(c.chance * 100)}
          <small>%</small>
        </span>
      </li>
    );
  };

  return (
    <OverlayShell title="Race predictor" settings={settings} setSetting={set} defs={DEFS}>
      <div className={`${shell.panel} ${styles.panel}`}>
        <header className={styles.head}>
          <span className={styles.title}>Who wins?</span>
          <span className={styles.finish}>
            {FINISH[finish.kind]}
            {finish.lastKmPct != null && ` · last km ${finish.lastKmPct.toFixed(1)}%`}
            {finish.remainingKm != null && ` · ${finish.remainingKm.toFixed(1)} km to go`}
          </span>
        </header>
        {!subgroup ? (
          <p className={styles.waiting}>{status === "connected" ? "The predictor runs in races." : "Connecting to Sauce…"}</p>
        ) : !top.length ? (
          <p className={styles.waiting}>Weighing up the field…</p>
        ) : (
          <ol className={styles.list}>
            {top.map((c, k) => row(c, k + 1))}
            {me && (
              <>
                <li className={styles.gapRow} aria-hidden>
                  ⋮
                </li>
                {row(me, meIndex + 1)}
              </>
            )}
          </ol>
        )}
        <p className={styles.note}>An estimate from today's efforts, FTP, Racing Score and recent races - riders out of Sauce's sight aren't counted.</p>
      </div>
    </OverlayShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PredictOverlay />
  </StrictMode>,
);
