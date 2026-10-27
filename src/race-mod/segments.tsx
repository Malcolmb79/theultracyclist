import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { cleanName, sauceRpc } from "../components/race/sauceFeed";
import type { RouteSegment } from "../components/race/courseMap";
import { OverlayShell, useSettings, type SettingDef } from "./overlay";
import { useSauce } from "./useSauce";
import { routePosition, useCourse } from "./useCourse";
import shell from "./Overlay.module.css";
import styles from "./Segments.module.css";

// Segment results, the way Zwift's HUD pops them up for sprints and KOMs:
// while the rider is on a segment, its leaderboard so far and the distance
// to the line; once they're over it, the result - where they placed, their
// time and the gap to the fastest - with the top of the board, then it goes.
// Results come from Zwift's live segment leaderboards through Sauce: this
// race's riders when they're in an event, otherwise everyone in the last
// hour. They trickle in for a few seconds after the line, so the board keeps
// refreshing while it's up.

const DEFAULTS = { opacity: 85, example: false, kinds: "sprints-climbs", rows: 5, showFor: 30, during: true, scope: "race" };
const DEFS: SettingDef[] = [
  { key: "example", label: "Show an example (for placing it)", type: "toggle" },
  {
    key: "kinds",
    label: "Segments",
    type: "select",
    options: [
      { value: "sprints-climbs", label: "Sprints and KOMs" },
      { value: "all", label: "All segments" },
    ],
  },
  { key: "during", label: "Show while on the segment", type: "toggle" },
  {
    key: "showFor",
    label: "Results stay up for",
    type: "select",
    options: [15, 30, 60, 120].map((s) => ({ value: s, label: s < 60 ? `${s} seconds` : `${s / 60} min` })),
  },
  { key: "rows", label: "Riders listed", type: "select", options: [3, 5, 8, 10].map((n) => ({ value: n, label: String(n) })) },
  {
    key: "scope",
    label: "Leaderboard",
    type: "select",
    options: [
      { value: "race", label: "This race (when racing)" },
      { value: "hour", label: "Everyone, last hour" },
    ],
  },
];

/** One time on a segment, as Zwift's leaderboard has it. */
interface SegmentResult {
  id?: string;
  athleteId: number;
  firstName?: string;
  lastName?: string;
  /** Seconds. */
  elapsed: number;
  avgPower?: number;
  weight?: number;
  /** When it was set, ms. */
  ts?: number;
  eventSubgroupId?: number;
  powerType?: string;
}

const REFRESH_MS = 4000;

function clock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m ? `${m}:${s.toFixed(1).padStart(4, "0")}` : `${s.toFixed(1)}s`;
}

function nameOf(r: SegmentResult): string {
  const first = cleanName(r.firstName);
  const last = cleanName(r.lastName);
  return last ? `${first ? `${first[0]}. ` : ""}${last}` : first || `Rider ${r.athleteId}`;
}

/** Each rider's best time only, fastest first. */
function board(results: SegmentResult[]): SegmentResult[] {
  const best = new Map<number, SegmentResult>();
  for (const r of results) {
    if (!(r.elapsed > 0)) continue;
    const had = best.get(r.athleteId);
    if (!had || r.elapsed < had.elapsed) best.set(r.athleteId, r);
  }
  return Array.from(best.values()).sort((a, b) => a.elapsed - b.elapsed);
}

/** The segment's leaderboard: this race's riders when racing (and asked), else the last hour. */
async function fetchBoard(address: string, segment: RouteSegment, subgroup: number | undefined, scope: string): Promise<SegmentResult[]> {
  if (scope === "race" && subgroup) {
    const live = await sauceRpc<SegmentResult[]>(address, "getSegmentResults", segment.id, { live: true }).catch(() => []);
    const ours = (live ?? []).filter((r) => r.eventSubgroupId === subgroup);
    if (ours.length) return board(ours);
  }
  return board((await sauceRpc<SegmentResult[]>(address, "getSegmentResults", segment.id).catch(() => [])) ?? []);
}

/** A made-up sprint result, to size and place the window by. */
const EXAMPLE_SEGMENT: RouteSegment = { id: 0, name: "Example Sprint", kind: "sprint", start: 0, end: 0 };
const EXAMPLE_ME = -1;
const EXAMPLE_RESULTS: SegmentResult[] = [
  ["Lambert", 24.1, 1180],
  ["Hartley", 24.8, 1105],
  ["You", 25.3, 1060],
  ["Cross", 25.9, 1010],
  ["Thompson", 26.4, 985],
  ["Smith", 27.0, 940],
  ["Jones", 27.7, 900],
  ["Norgaard", 28.2, 870],
  ["Ng", 28.9, 845],
  ["Rossi", 29.5, 820],
].map(([lastName, elapsed, avgPower], i) => ({
  athleteId: lastName === "You" ? EXAMPLE_ME : i + 1,
  lastName: lastName as string,
  elapsed: elapsed as number,
  avgPower: avgPower as number,
  weight: 75,
  ts: Date.now(),
}));

type Phase = { kind: "on"; segment: RouteSegment } | { kind: "done"; segment: RouteSegment; at: number } | null;

function SegmentsOverlay() {
  const [settings, set] = useSettings("segments", DEFAULTS);
  const { address, watching } = useSauce({});
  const { route } = useCourse(address, watching);
  const s = watching?.state;
  const at = route ? routePosition(route, s) : undefined;
  const [phase, setPhase] = useState<Phase>(null);
  const [results, setResults] = useState<SegmentResult[]>([]);
  const last = useRef<{ segment?: RouteSegment; at?: number }>({});

  // Where the rider is: on a segment, just over one, or neither.
  const wanted = (seg: RouteSegment) => settings.kinds === "all" || seg.kind !== "segment";
  const on = route && at != null ? route.segments.find((seg) => wanted(seg) && seg.start <= at && at <= seg.end) : undefined;
  useEffect(() => {
    const prev = last.current;
    last.current = { segment: on, at };
    if (on) {
      if (phase?.kind !== "on" || phase.segment !== on) setPhase({ kind: "on", segment: on });
      return;
    }
    // Off a segment it was on, past its end (not a teleport or a U-turn): the result.
    if (prev.segment && prev.at != null && at != null && at > prev.segment.end - 50 && at - prev.segment.end < 500) {
      setPhase({ kind: "done", segment: prev.segment, at: Date.now() });
      return;
    }
    if (phase?.kind === "on") setPhase(null);
    // Only the segment the rider is on, and their position, decide this.
  }, [on, at]); // eslint-disable-line react-hooks/exhaustive-deps

  // The result stays up for a while, then goes.
  useEffect(() => {
    if (phase?.kind !== "done") return;
    const t = setTimeout(() => setPhase(null), settings.showFor * 1000);
    return () => clearTimeout(t);
  }, [phase, settings.showFor]);

  // The leaderboard, kept fresh while it's showing.
  const subgroup = s?.eventSubgroupId || undefined;
  const segment = phase?.segment;
  const showing = segment && (phase?.kind === "done" || settings.during);
  useEffect(() => {
    if (!showing || !segment) {
      setResults([]);
      return;
    }
    let live = true;
    const load = () => void fetchBoard(address, segment, subgroup, settings.scope).then((r) => live && setResults(r));
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [showing, segment, address, subgroup, settings.scope]);

  // The example stands in for what is shown: a sprint just finished, third.
  const example = settings.example;
  const shownPhase: Phase = example ? { kind: "done", segment: EXAMPLE_SEGMENT, at: Date.now() - 60_000 } : phase;
  const shownResults = example ? EXAMPLE_RESULTS : results;
  const shownSegment = shownPhase?.segment;
  const isShowing = example || showing;
  const me = example ? EXAMPLE_ME : watching?.athleteId;
  const myIdx = shownResults.findIndex((r) => r.athleteId === me);
  // In results, only a time set on this pass counts as the rider's.
  const mine = myIdx >= 0 && (shownPhase?.kind !== "done" || (shownResults[myIdx].ts ?? Infinity) >= shownPhase.at - 120_000) ? shownResults[myIdx] : undefined;
  const best = shownResults[0];
  const top = shownResults.slice(0, settings.rows);
  const extra = mine && myIdx >= settings.rows ? mine : undefined;
  const toLine = shownPhase?.kind === "on" && at != null ? Math.max(0, shownPhase.segment.end - at) : undefined;

  return (
    <OverlayShell title="Segment results" settings={settings} setSetting={set} defs={DEFS}>
      {isShowing && shownSegment ? (
        <div className={`${shell.panel} ${styles.panel} ${styles[shownSegment.kind] ?? ""}`}>
          <div className={styles.head}>
            <span className={styles.kind}>{shownSegment.kind === "sprint" ? "Sprint" : shownSegment.kind === "climb" ? "KOM" : "Segment"}</span>
            <span className={styles.name}>{shownSegment.name}</span>
            {toLine != null && <span className={styles.toLine}>{toLine >= 1000 ? `${(toLine / 1000).toFixed(1)} km` : `${Math.round(toLine)} m`}</span>}
          </div>
          {shownPhase?.kind === "done" && (
            <div className={styles.mine}>
              {mine ? (
                <>
                  <span className={styles.place}>{myIdx + 1}</span>
                  <span className={styles.ofN}>of {shownResults.length}</span>
                  <span className={styles.time}>{clock(mine.elapsed)}</span>
                  <span className={styles.delta}>{best && best !== mine ? `+${(mine.elapsed - best.elapsed).toFixed(1)}s` : "Fastest!"}</span>
                </>
              ) : (
                <span className={styles.waiting}>Waiting for your time…</span>
              )}
            </div>
          )}
          {top.length > 0 ? (
            <ol className={styles.list}>
              {top.map((r, i) => (
                <Row key={r.athleteId} r={r} place={i + 1} best={best} self={r.athleteId === me} />
              ))}
              {extra && <Row r={extra} place={myIdx + 1} best={best} self gapAbove />}
            </ol>
          ) : (
            <p className={styles.waiting}>No times yet</p>
          )}
        </div>
      ) : (
        <div className={styles.idle}>Segment shownResults appear on sprints and KOMs · right-click for settings</div>
      )}
    </OverlayShell>
  );
}

function Row({ r, place, best, self, gapAbove }: { r: SegmentResult; place: number; best?: SegmentResult; self: boolean; gapAbove?: boolean }) {
  const wkg = r.avgPower && r.weight ? r.avgPower / r.weight : undefined;
  return (
    <li className={`${styles.row} ${self ? styles.self : ""} ${gapAbove ? styles.gapAbove : ""}`}>
      <span className={`${styles.pos} ${place <= 3 ? styles[`p${place}`] : ""}`}>{place}</span>
      <span className={styles.who}>{nameOf(r)}</span>
      {wkg != null && <span className={styles.wkg}>{wkg.toFixed(1)}</span>}
      <span className={styles.rowTime}>{place === 1 || !best ? clock(r.elapsed) : `+${(r.elapsed - best.elapsed).toFixed(1)}`}</span>
    </li>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SegmentsOverlay />
  </StrictMode>,
);
