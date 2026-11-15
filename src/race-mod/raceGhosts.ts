import type { SauceAthleteData } from "../components/race/sauceFeed";
import { inRace } from "../components/race/sameRace";

// Riders in the watched rider's race who've gone out of range. Zwift only
// sends riders near you, so someone minutes up the road drops off Sauce's
// list - and off the board, taking their place with them. Each one seen in
// this race is remembered with where they were and how fast they were going,
// and carried on from there: an estimated distance, and from it a gap, until
// they come back into range (when their real data takes over again).
// Kept in storage per race, so reopening the board mid-race keeps them.

type Seen = {
  r: SauceAthleteData;
  /** When last seen, ms. */
  at: number;
  /** Event distance then, m. */
  dist: number;
  /** Their speed, smoothed over about a minute, m/s. */
  speed: number;
};

const KEY = "board:ghosts";
/** Forget a rider not seen for this long - they've probably left. */
const FORGET_MS = 3 * 60 * 60 * 1000;
/** Speeds are smoothed over about this long. */
const SMOOTH_S = 60;

let race: number | undefined;
let seen = new Map<number, Seen>();
let mine: { at: number; speed: number } | null = null;
let savedAt = 0;

const dist = (r: SauceAthleteData) => (r.state as { eventDistance?: number } | null | undefined)?.eventDistance;
const mps = (r: SauceAthleteData) => (r.state?.speed != null ? r.state.speed / 3.6 : undefined);

function smooth(prev: number | undefined, prevAt: number | undefined, value: number, now: number): number {
  if (prev == null || prevAt == null) return value;
  const a = 1 - Math.exp(-Math.max(0, now - prevAt) / 1000 / SMOOTH_S);
  return prev + (value - prev) * a;
}

function load(sub: number) {
  race = sub;
  seen = new Map();
  mine = null;
  try {
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as { race: number; seen: [number, Seen][] } | null;
    if (stored?.race === sub) seen = new Map(stored.seen);
  } catch {
    // Starts empty.
  }
}

function save(now: number) {
  if (now - savedAt < 5000) return;
  savedAt = now;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ race, seen: [...seen] }));
  } catch {
    // Kept in memory for this window anyway.
  }
}

/**
 * The race's riders out of range, carried on from where they were last seen,
 * with an estimated gap to the watched rider. Called with every update.
 */
export function ghostRiders(nearby: SauceAthleteData[], watching: SauceAthleteData | null): SauceAthleteData[] {
  const sub = watching?.state?.eventSubgroupId || undefined;
  if (!sub || !watching) return [];
  if (sub !== race) load(sub);
  const now = Date.now();

  const myDist = dist(watching);
  const mySpeed = mps(watching);
  if (mySpeed != null) mine = { at: now, speed: smooth(mine?.speed, mine?.at, mySpeed, now) };

  const here = new Set<number>();
  for (const r of nearby) {
    here.add(r.athleteId);
    if (r.watching || r.athleteId === watching.athleteId || !inRace(r, sub) || !r.state?.eventSubgroupId) continue;
    const d = dist(r);
    const v = mps(r);
    if (d == null || v == null) continue;
    const prev = seen.get(r.athleteId);
    seen.set(r.athleteId, {
      r: { athleteId: r.athleteId, athlete: r.athlete, state: r.state },
      at: now,
      dist: d,
      speed: smooth(prev?.speed, prev?.at, v, now),
    });
  }
  save(now);

  if (myDist == null) return [];
  const pace = Math.max(3, mine?.speed ?? 10);
  const out: SauceAthleteData[] = [];
  for (const [id, s] of seen) {
    if (here.has(id)) continue;
    const age = now - s.at;
    if (age > FORGET_MS) {
      seen.delete(id);
      continue;
    }
    const est = s.dist + (s.speed * age) / 1000;
    out.push({
      athleteId: id,
      athlete: s.r.athlete,
      // Nothing live is known: just where they'd be by now.
      state: { ...(s.r.state ?? {}), eventDistance: est, power: undefined, speed: undefined, heartrate: undefined, activePowerUp: undefined } as SauceAthleteData["state"],
      gap: -(est - myDist) / pace,
      gapDistance: myDist - est,
    });
  }
  return out;
}
