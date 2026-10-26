import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { loadEventBrief, loadResults } from "../components/race/eventInfo";
import { cleanName, type SauceAthleteData } from "../components/race/sauceFeed";
import { inRace } from "../components/race/sameRace";
import { scoreTeams, type LadderEntry, type TeamStanding } from "../components/race/ladder";
import type { RaceResult } from "../components/race/raceLog";
import { OverlayShell, useSettings, type SettingDef } from "./overlay";
import { useSauce } from "./useSauce";
import shell from "./Overlay.module.css";
import styles from "./Ladder.module.css";

// A Club Ladder race's score as it stands, the way a TV graphic shows a
// team event: the two teams, their points and a bar for who's ahead, with
// each rider's place and the points it's worth. When the race ends it
// turns into the final score, from Zwift's official results once they're
// in. Same scoring as the commentator's (components/race/ladder.ts).

const DEFAULTS = { opacity: 85, riders: true, gaps: true };
const DEFS: SettingDef[] = [
  { key: "riders", label: "Riders and their points", type: "toggle" },
  { key: "gaps", label: "Gaps", type: "toggle" },
];

/** How long to keep asking for the official results after the finish. */
const RESULTS_FOR_MS = 10 * 60_000;
const RESULTS_EVERY_MS = 15_000;

function name(a: SauceAthleteData): string {
  return [cleanName(a.athlete?.firstName), cleanName(a.athlete?.lastName)].filter(Boolean).join(" ") || `Rider ${a.athleteId}`;
}

function LadderOverlay() {
  const [settings, set] = useSettings("ladder", DEFAULTS);
  const { address, status, watching, nearby } = useSauce({ nearby: true });
  const subgroup = watching?.state?.eventSubgroupId || undefined;
  const [eventName, setEventName] = useState<string | undefined>();
  const [results, setResults] = useState<RaceResult[] | null>(null);
  // Everyone seen in the race, kept through the finish so the final score knows their teams.
  const seen = useRef(new Map<number, { name: string; team?: string }>());
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    setEventName(undefined);
    setResults(null);
    setFinished(false);
    seen.current.clear();
    if (!subgroup) return;
    void loadEventBrief(address, subgroup)
      .then((b) => setEventName(b?.name))
      .catch(() => undefined);
  }, [address, subgroup]);

  // The rider's own race only, and everyone in it remembered.
  const field = useMemo(() => nearby.filter((r) => inRace(r, subgroup)), [nearby, subgroup]);
  for (const r of field) seen.current.set(r.athleteId, { name: name(r), team: r.athlete?.team?.trim() || undefined });

  // Over the line: the remaining distance or time has run out.
  useEffect(() => {
    if (watching?.remainingType === "event" && watching.remaining != null && watching.remaining <= 0) setFinished(true);
  }, [watching?.remaining, watching?.remainingType]);

  // Then the official results, as Zwift publishes them.
  useEffect(() => {
    if (!finished || !subgroup) return;
    const started = Date.now();
    const poll = () => {
      if (Date.now() - started > RESULTS_FOR_MS) return clearInterval(timer);
      loadResults(address, subgroup)
        .then((list) => list.length && setResults(list))
        .catch(() => undefined);
    };
    const timer = setInterval(poll, RESULTS_EVERY_MS);
    poll();
    return () => clearInterval(timer);
  }, [finished, address, subgroup]);

  const tag = watching?.athlete?.team?.trim();
  const standing: TeamStanding | undefined = useMemo(() => {
    const entries: LadderEntry[] = results
      ? results.map((r) => ({ name: seen.current.get(r.athleteId)?.name ?? r.name, team: seen.current.get(r.athleteId)?.team, pos: r.rank }))
      : field.map((r) => ({ name: name(r), team: r.athlete?.team?.trim(), pos: r.eventPosition || undefined, gap: r.gap }));
    return scoreTeams(entries, tag, eventName);
  }, [results, field, tag, eventName]);

  const final = finished || !!results;
  const problem = !watching
    ? status === "connected"
      ? "Waiting for Zwift…"
      : "Connecting to Sauce…"
    : !subgroup
      ? "Not in an event."
      : !tag
        ? "Wear your team tag to score the teams."
        : !standing
          ? "Waiting for both teams…"
          : null;

  return (
    <OverlayShell title="Ladder score" settings={settings} setSetting={set} defs={DEFS}>
      <div className={`${shell.panel} ${styles.panel} ${final ? styles.final : ""}`}>
        {problem || !standing ? (
          <p className={styles.waiting}>{problem}</p>
        ) : (
          <>
            {final && (
              <div className={`${styles.banner} ${styles[standing.leading]}`}>
                {standing.leading === "level"
                  ? "Draw"
                  : standing.leading === "ours"
                    ? `${standing.ours.name} win`
                    : `${standing.theirs.name} win`}
                <span>{results ? "Final result" : "Provisional - waiting for official results"}</span>
              </div>
            )}
            <div className={styles.score}>
              <Team team={standing.ours} side="ours" leading={standing.leading === "ours"} />
              <span className={styles.dash}>–</span>
              <Team team={standing.theirs} side="theirs" leading={standing.leading === "theirs"} />
            </div>
            <div className={styles.bar} aria-hidden>
              <span
                className={styles.oursBar}
                style={{ width: `${(standing.ours.points / Math.max(1, standing.ours.points + standing.theirs.points)) * 100}%` }}
              />
            </div>
            {!final && <p className={styles.state}>{standing.leading === "level" ? "Level on points" : `${standing.leading === "ours" ? standing.ours.name : standing.theirs.name} lead by ${standing.margin}`}</p>}
            {settings.riders && (
              <ol className={styles.riders}>
                {[...standing.ours.riders.map((r) => ({ ...r, side: "ours" as const })), ...standing.theirs.riders.map((r) => ({ ...r, side: "theirs" as const }))]
                  .sort((a, b) => (a.pos ?? 999) - (b.pos ?? 999))
                  .map((r) => (
                    <li key={`${r.side}-${r.name}`} className={`${styles.rider} ${styles[r.side]}`}>
                      <span className={styles.pos}>{r.pos ?? "–"}</span>
                      <span className={styles.who}>{r.name}</span>
                      {settings.gaps && !final && r.gap != null && <span className={styles.gap}>{r.gap > 0 ? "+" : ""}{Math.round(r.gap)}s</span>}
                      <span className={styles.pts}>{r.points}</span>
                    </li>
                  ))}
              </ol>
            )}
          </>
        )}
      </div>
    </OverlayShell>
  );
}

function Team({ team, side, leading }: { team: TeamStanding["ours"]; side: "ours" | "theirs"; leading: boolean }) {
  return (
    <div className={`${styles.team} ${styles[side]} ${leading ? styles.leader : ""}`}>
      <span className={styles.teamName}>{team.name}</span>
      <span className={styles.points}>{team.points}</span>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LadderOverlay />
  </StrictMode>,
);
