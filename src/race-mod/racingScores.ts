import type { SauceAthleteData, SauceGroup } from "../components/race/sauceFeed";
import { sauceRpc } from "../components/race/sauceFeed";
import { SITE } from "./site";

// Riders' Zwift Racing Score and category, where Sauce hasn't got them:
// Sauce loads other riders' profiles in bulk, and those leave the racing
// score out. Looked up through the site (api/_routes/zwift-riders.ts) a few
// riders at a time, kept in this window for the session and filled into
// the riders each overlay is given.

type Score = { racingScore?: number; category?: string } | null;

const known = new Map<number, Score>();
const queued = new Set<number>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

/** A few riders a call, and a short pause between calls - a field of 100 in about 20 seconds. */
const BATCH = 8;
const EVERY_MS = 1500;

function raceKey(): string | null {
  try {
    const raw = window.localStorage.getItem("race:commentary-key");
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return typeof v === "string" && v ? v : null;
  } catch {
    return null;
  }
}

function lookUp() {
  timer = null;
  const key = raceKey();
  const ids = Array.from(queued).slice(0, BATCH);
  if (!key || !ids.length) return;
  for (const id of ids) queued.delete(id);
  void fetch(`${SITE}/api/zwift-riders?ids=${ids.join(",")}`, { headers: { authorization: `Bearer ${key}` }, credentials: "omit" })
    .then((r) => (r.ok ? (r.json() as Promise<{ configured?: boolean; riders?: Record<string, Score> }>) : null))
    .then((body) => {
      if (!body || body.configured === false) return;
      for (const id of ids) known.set(id, body.riders?.[String(id)] ?? null);
      listeners.forEach((l) => l());
    })
    .catch(() => {
      // Not now: they'll be asked for again when next seen.
    })
    .finally(() => {
      if (queued.size && !timer) timer = setTimeout(lookUp, EVERY_MS);
    });
}

/** The riders with their racing score filled in where Sauce hasn't got it; the rest queued to look up. */
export function withScores(riders: SauceAthleteData[]): SauceAthleteData[] {
  let missing = false;
  const out = riders.map((r) => {
    if (r.athlete?.racingScore) return r;
    const s = known.get(r.athleteId);
    if (s === undefined) {
      if (!queued.has(r.athleteId)) {
        queued.add(r.athleteId);
        missing = true;
      }
      return r;
    }
    if (!s?.racingScore) return r;
    return { ...r, athlete: { ...r.athlete, racingScore: s.racingScore, racingCategory: r.athlete?.racingCategory ?? s.category } };
  });
  if (missing && !timer) timer = setTimeout(lookUp, 500);
  return out;
}

export function groupsWithScores(groups: SauceGroup[]): SauceGroup[] {
  return groups.map((g) => ({ ...g, athletes: withScores(g.athletes ?? []) }));
}

/** Told when new scores arrive, to show them. */
export function onScores(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const entrantsDone = new Set<number>();

/**
 * The race's whole entry list, from the start pen: riders not yet in sight
 * are looked up too, so the scores are there before the start. Sauce's
 * entrants come with their profiles, which can carry the score already.
 */
export function prefetchEntrants(address: string, subgroup: number) {
  if (entrantsDone.has(subgroup)) return;
  entrantsDone.add(subgroup);
  void sauceRpc<{ id: number; athlete?: { racingScore?: number; racingCategory?: string } }[] | null>(address, "getEventSubgroupEntrants", subgroup)
    .then((entrants) => {
      let added = false;
      for (const e of entrants ?? []) {
        if (known.has(e.id)) continue;
        if (e.athlete?.racingScore) known.set(e.id, { racingScore: Math.round(e.athlete.racingScore), category: e.athlete.racingCategory });
        else if (!queued.has(e.id)) {
          queued.add(e.id);
          added = true;
        }
      }
      listeners.forEach((l) => l());
      if (added && !timer) timer = setTimeout(lookUp, 500);
    })
    .catch(() => {
      // Sauce couldn't get the entry list: riders are looked up as they're seen.
      entrantsDone.delete(subgroup);
    });
}
