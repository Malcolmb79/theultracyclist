import { useEffect, useMemo, useRef, useState } from "react";
import { sauceRpc, type SauceAthleteData } from "../components/race/sauceFeed";
import { fromSauceWorkout, parseWorkout, stepAt, targetAt, type WorkoutPlan, type XmlNode } from "./workoutPlan";

// The Zwift workout being ridden, for the workout strip and panel, from
// whichever source has it:
//
// - live: the workout file and progress Zwift sends Sauce over its Game
//   Connection (getWorkoutStatus) - in Sauce 2.4 on, and only when Sauce
//   was listening as the workout started;
// - zwift: otherwise, the workout fetched from Zwift through Sauce
//   (getWorkout) - today's scheduled one, or one the rider picks - placed
//   by the workout progress that comes with the rider's own data.

export interface SauceWorkoutStatus {
  info?: { workoutHash?: number; file?: XmlNode; durationType?: number } | null;
  state?: {
    currentProgressValue?: number;
    workoutBlockStates?: { blockIndex?: number; starsAwarded?: number }[];
    isPaused?: boolean;
    isFinished?: boolean;
    isInERGMode?: boolean;
    intensityBias?: number;
    currentBlockTime?: number;
  } | null;
}

export interface WorkoutChoice {
  id: string;
  name: string;
  scheduled: boolean;
}

export interface Workout {
  plan: WorkoutPlan | null;
  /** Seconds (or metres) into it. */
  at?: number;
  source: "live" | "zwift" | "example" | null;
  /** Riding a workout, whether or not its blocks are known. */
  inWorkout: boolean;
  /** From the rider's data: share done and the zone being ridden. */
  progress?: number;
  zone?: number;
  distance: boolean;
  bias: number;
  ftp?: number;
  erg?: boolean;
  paused?: boolean;
  finished?: boolean;
  stars?: number;
  /** Sauce's Game Connection: off means no live workout at all. */
  connected: boolean | null;
  /** For picking the workout when it has to come from Zwift. */
  choices: WorkoutChoice[];
  picked?: string;
  /** How it was chosen: by the rider, planned for today, or matched to their zones. */
  how?: "picked" | "planned" | "matched";
  pick: (id: string) => void;
  /** What came back, for checking against a real workout. */
  raw: unknown;
}

const POLL_MS = 1000;
const PICK_KEY = "workout:picked";

/** The local day, for keeping a picked workout for the day. */
const today = () => new Date().toDateString();

function loadPick(): string | undefined {
  try {
    const v = JSON.parse(window.localStorage.getItem(PICK_KEY) ?? "null") as { id?: string; day?: string } | null;
    return v?.day === today() ? v.id : undefined;
  } catch {
    return undefined;
  }
}

function clearPick() {
  try {
    window.localStorage.removeItem(PICK_KEY);
  } catch {
    // Nothing kept anyway.
  }
}

function savePick(id: string) {
  try {
    window.localStorage.setItem(PICK_KEY, JSON.stringify({ id, day: today() }));
  } catch {
    // Not kept: it'll ask again next time.
  }
}

interface Candidate {
  /** Every id Zwift gave it - a schedule entry has its own as well as the workout's. */
  ids: string[];
  name: string;
  /** When it's planned for, if it is. */
  date?: Date;
}

/** A date however Zwift writes it: ISO text, a day, or seconds or milliseconds. */
function toDate(v: unknown): Date | undefined {
  if (typeof v === "number" && v > 0) return new Date(v < 1e11 ? v * 1000 : v);
  if (typeof v === "string" && v.trim()) {
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00` : v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}

const isToday = (d: Date | undefined) => !!d && d.toDateString() === new Date().toDateString();

/** Anything that looks like a workout - an id and a name - wherever it sits in what Zwift returns. */
function workoutsIn(x: unknown, depth = 0): Candidate[] {
  if (depth > 5 || x == null) return [];
  if (Array.isArray(x)) return x.flatMap((v) => workoutsIn(v, depth + 1));
  if (typeof x !== "object") return [];
  const o = x as Record<string, unknown>;
  const inner = o.workout && typeof o.workout === "object" ? (o.workout as Record<string, unknown>) : undefined;
  const name = o.name ?? inner?.name ?? o.title ?? o.workoutName;
  const ids = [o.workoutId, inner?.id, o.id]
    .filter((v) => typeof v === "number" || (typeof v === "string" && v !== ""))
    .map(String)
    .filter((v, i, all) => all.indexOf(v) === i);
  if (ids.length && typeof name === "string") {
    const date = [o.date, o.scheduledDate, o.scheduledFor, o.startDate, o.startTime, o.day, o.plannedDate, inner?.date]
      .map(toDate)
      .find(Boolean);
    return [{ ids, name, date }];
  }
  return Object.values(o).flatMap((v) => (v && typeof v === "object" ? workoutsIn(v, depth + 1) : []));
}

/** Zwift's zone for a target, as a share of FTP - the zone the rider's data reports. */
function zoneOf(share: number): number {
  return [0.6, 0.76, 0.9, 1.05, 1.18].findIndex((upTo) => share < upTo) + 1 || 6;
}

/** Riding observations, to tell which workout this is: progress and zone over time. */
interface Seen {
  t: number;
  p: number;
  z: number;
}

/** Enough to go on, and how sure it must be. */
const MATCH_MIN_SEEN = 20;
const MATCH_SCORE = 0.85;
const MATCH_MARGIN = 0.15;
/** How far the workout's length may be from the one its progress suggests. */
const LENGTH_SLACK = 0.25;
/** Plans looked at: today's, then the rider's other workouts. */
const MAX_CANDIDATES = 24;

/**
 * Which workout fits what the rider's data has shown: the zone at each
 * point of progress, and the length the progress rate gives. Undefined
 * until one fits clearly better than the rest.
 */
export function matchWorkout(seen: Seen[], plans: Map<string, WorkoutPlan>): string | undefined {
  if (seen.length < MATCH_MIN_SEEN || !plans.size) return undefined;
  // How fast the progress moves gives the length: it steps 1/255 at a time.
  const steps = seen.filter((s, k) => k > 0 && s.p > seen[k - 1].p);
  const estimate =
    steps.length >= 3 ? (steps[steps.length - 1].t - steps[0].t) / 1000 / (steps[steps.length - 1].p - steps[0].p) : undefined;
  const scores: { id: string; score: number }[] = [];
  for (const [id, plan] of plans) {
    if (estimate && Math.abs(estimate - plan.total) / plan.total > LENGTH_SLACK) continue;
    let n = 0;
    let hits = 0;
    const fuzz = plan.total / 255;
    for (const s of seen) {
      const zones = new Set<number>();
      for (const d of [-fuzz, 0, fuzz]) {
        const at = Math.min(plan.total - 0.1, Math.max(0, s.p * plan.total + d));
        const step = plan.steps[stepAt(plan, at)];
        const share = step && targetAt(step, at);
        if (share != null) zones.add(zoneOf(share));
      }
      if (!zones.size) continue;
      n++;
      if (zones.has(s.z)) hits++;
    }
    if (n >= MATCH_MIN_SEEN) scores.push({ id, score: hits / n });
  }
  scores.sort((a, b) => b.score - a.score);
  const [best, second] = scores;
  if (!best || best.score < MATCH_SCORE) return undefined;
  return !second || best.score - second.score >= MATCH_MARGIN ? best.id : undefined;
}

export function useWorkout(address: string, watching: SauceAthleteData | null, example: boolean, exampleFile: XmlNode, exampleAt: number): Workout {
  const [status, setStatus] = useState<SauceWorkoutStatus | null>(null);
  const [polledAt, setPolledAt] = useState(0);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [, tick] = useState(0);

  // The live feed, and whether the Game Connection is up.
  useEffect(() => {
    if (example) return;
    let live = true;
    let n = 0;
    const poll = () => {
      void sauceRpc<SauceWorkoutStatus | null>(address, "getWorkoutStatus")
        .then((s) => {
          if (!live) return;
          setStatus(s ?? null);
          setPolledAt(Date.now());
        })
        .catch(() => live && setStatus(null));
      if (n++ % 5 === 0) {
        void sauceRpc<{ gameConnection?: boolean } | null>(address, "getGameState")
          .then((g) => live && setConnected(!!g?.gameConnection))
          .catch(() => live && setConnected(false));
      }
    };
    poll();
    const t = setInterval(poll, POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [address, example]);

  // A clock for the countdowns between updates.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, []);

  const ftp = watching?.athlete?.ftp ?? (example ? 280 : undefined);
  const zone = watching?.state?.workoutZone || undefined;
  const progress = watching?.state?.progress;
  const liveFile = status?.info?.file;
  const inWorkout = example || !!liveFile || !!zone;

  // No live file but in a workout: the workout from Zwift - the one the
  // rider picked, else the one planned for today, else whichever fits what
  // their zone and progress have shown.
  const needZwift = !example && !liveFile && !!zone;
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [raw, setRaw] = useState<unknown>(null);
  const [picked, setPicked] = useState<string | undefined>(() => loadPick());
  const [plans, setPlans] = useState<Map<string, WorkoutPlan | null>>(new Map());
  const [matched, setMatched] = useState<string | undefined>();
  const seen = useRef<Seen[]>([]);
  const maxProgress = useRef(0);

  useEffect(() => {
    if (!needZwift) return;
    let live = true;
    void Promise.all([
      sauceRpc<unknown>(address, "getWorkoutSchedule").catch((e: Error) => ({ error: e.message })),
      sauceRpc<unknown>(address, "getWorkouts").catch((e: Error) => ({ error: e.message })),
    ]).then(([schedule, all]) => {
      if (!live) return;
      const planned = workoutsIn(schedule);
      const mine = workoutsIn(all).sort((a, b) => a.name.localeCompare(b.name));
      const seenIds = new Set<string>();
      const list: Candidate[] = [];
      // Today's first, then the rest of the schedule, then the rider's own workouts.
      for (const c of [...planned.filter((c) => isToday(c.date)), ...planned.filter((c) => !isToday(c.date)), ...mine]) {
        if (c.ids.some((id) => seenIds.has(id))) continue;
        c.ids.forEach((id) => seenIds.add(id));
        list.push(c);
      }
      setCandidates(list);
      setRaw({ schedule, workouts: Array.isArray(all) ? `${all.length} workouts` : all });
    });
    return () => {
      live = false;
    };
  }, [address, needZwift]);

  // Each candidate's blocks, one at a time - trying each of its ids until Zwift has it.
  useEffect(() => {
    if (!needZwift) return;
    const want = candidates.slice(0, MAX_CANDIDATES).filter((c) => !plans.has(c.ids[0]));
    // The one picked comes first, wherever it is in the list.
    const first = candidates.find((c) => c.ids[0] === picked && !plans.has(c.ids[0])) ?? want[0];
    if (!first) return;
    let live = true;
    void (async () => {
      let plan: WorkoutPlan | null = null;
      for (const id of first.ids) {
        const w = await sauceRpc<unknown>(address, "getWorkout", id).catch(() => null);
        plan = parseWorkout(fromSauceWorkout(w), ftp ?? undefined);
        if (plan) break;
      }
      if (live) setPlans((m) => new Map(m).set(first.ids[0], plan ? { ...plan, name: plan.name ?? first.name } : null));
    })();
    return () => {
      live = false;
    };
  }, [address, needZwift, candidates, plans, picked, ftp]);

  // What the rider's data shows, for matching - started afresh with each new workout.
  useEffect(() => {
    if (!needZwift || progress == null || !zone) return;
    if (progress < maxProgress.current - 0.05) {
      seen.current = [];
      setMatched(undefined);
      setPicked(undefined);
      clearPick();
    }
    maxProgress.current = progress < maxProgress.current - 0.05 ? progress : Math.max(maxProgress.current, progress);
    seen.current = [...seen.current, { t: Date.now(), p: progress, z: zone }].slice(-900);
  }, [watching]); // eslint-disable-line react-hooks/exhaustive-deps

  const today1 = candidates.filter((c) => isToday(c.date));
  const plannedToday = today1.length === 1 && plans.get(today1[0].ids[0]) ? today1[0].ids[0] : undefined;
  useEffect(() => {
    if (!needZwift || picked || plannedToday || matched) return;
    const ok = new Map<string, WorkoutPlan>();
    for (const [id, plan] of plans) if (plan) ok.set(id, plan);
    setMatched(matchWorkout(seen.current, ok));
  });
  const chosen = picked ?? plannedToday ?? matched;
  const choices: WorkoutChoice[] = candidates.map((c) => ({ id: c.ids[0], name: c.name, scheduled: isToday(c.date) }));
  const pickedPlan = chosen ? plans.get(chosen) : undefined;

  const source: Workout["source"] = example ? "example" : liveFile ? "live" : needZwift && pickedPlan ? "zwift" : null;
  const file = source === "example" ? exampleFile : source === "live" ? liveFile : null;
  const parsed = useMemo(() => parseWorkout(file, ftp ?? undefined), [file, ftp]);
  const plan = source === "zwift" ? pickedPlan! : parsed;
  const state = source === "live" ? status?.state : undefined;
  const distance = source === "live" && status?.info?.durationType === 1;

  // Where the rider is. Live, Zwift's progress is seconds (or metres) in -
  // or, if it never gets past 1, a fraction. From the rider's data it's a
  // fraction in 1/255ths, so the clock runs on between its steps.
  const scale = useRef({ hash: 0, first: 0, max: 0 });
  const hash = status?.info?.workoutHash ?? 0;
  const p = state?.currentProgressValue;
  if (scale.current.hash !== hash) scale.current = { hash, first: Date.now(), max: 0 };
  if (p != null) scale.current.max = Math.max(scale.current.max, p);
  const fraction = scale.current.max <= 1.0001 && Date.now() - scale.current.first > 20_000;
  const coarse = useRef({ value: -1, since: 0 });
  if (progress != null && progress !== coarse.current.value) coarse.current = { value: progress, since: Date.now() };

  let at: number | undefined;
  if (source === "example") at = exampleAt + ((Date.now() / 1000) % 6);
  else if (plan && source === "live" && p != null) {
    at = fraction ? p * plan.total : p;
    if (!distance && !state?.isPaused && !state?.isFinished) at += Math.min(1.5, (Date.now() - polledAt) / 1000);
  } else if (plan && source === "zwift" && progress != null) {
    const step = plan.total / 255;
    at = progress * plan.total + Math.min(step, (Date.now() - coarse.current.since) / 1000);
  }
  if (plan && at != null) at = Math.min(plan.total, Math.max(0, at));

  const b = state?.intensityBias ?? 1;
  const bias = b > 3 ? b / 100 : b || 1;

  return {
    plan,
    at,
    source,
    inWorkout,
    progress,
    zone,
    distance,
    bias,
    ftp: ftp ?? undefined,
    erg: source === "example" ? true : state?.isInERGMode,
    paused: state?.isPaused,
    finished: state?.isFinished,
    stars: state?.workoutBlockStates?.reduce((a, s) => a + (s.starsAwarded ?? 0), 0),
    connected,
    choices,
    picked: chosen,
    how: picked ? "picked" : plannedToday ? "planned" : matched ? "matched" : undefined,
    pick: (id: string) => {
      savePick(id);
      setPicked(id);
    },
    raw: source === "live" ? status : { status, zwift: raw, progress, zone, seen: seen.current.length, candidates: candidates.length, loaded: plans.size },
  };
}
