import { useEffect, useMemo, useRef, useState } from "react";
import { sauceRpc, type SauceAthleteData } from "../components/race/sauceFeed";
import { fromSauceWorkout, parseWorkout, type WorkoutPlan, type XmlNode } from "./workoutPlan";

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
  pick: (id: string) => void;
  /** What came back, for checking against a real workout. */
  raw: unknown;
}

const POLL_MS = 1000;
const PICK_KEY = "workout:picked";

const today = () => new Date().toISOString().slice(0, 10);

function loadPick(): string | undefined {
  try {
    const v = JSON.parse(window.localStorage.getItem(PICK_KEY) ?? "null") as { id?: string; day?: string } | null;
    return v?.day === today() ? v.id : undefined;
  } catch {
    return undefined;
  }
}

function savePick(id: string) {
  try {
    window.localStorage.setItem(PICK_KEY, JSON.stringify({ id, day: today() }));
  } catch {
    // Not kept: it'll ask again next time.
  }
}

/** Anything that looks like a workout - an id and a name - wherever it sits in what Zwift returns. */
function workoutsIn(x: unknown, depth = 0): { id: string; name: string; date?: string }[] {
  if (depth > 4 || x == null) return [];
  if (Array.isArray(x)) return x.flatMap((v) => workoutsIn(v, depth + 1));
  if (typeof x !== "object") return [];
  const o = x as Record<string, unknown>;
  const inner = o.workout && typeof o.workout === "object" ? (o.workout as Record<string, unknown>) : undefined;
  const id = o.workoutId ?? inner?.id ?? o.id;
  const name = o.name ?? inner?.name ?? o.title;
  if ((typeof id === "number" || typeof id === "string") && typeof name === "string") {
    const date = [o.date, o.scheduledDate, o.startDate, o.day].find((d) => typeof d === "string") as string | undefined;
    return [{ id: String(id), name, date }];
  }
  return Object.values(o).flatMap((v) => (v && typeof v === "object" ? workoutsIn(v, depth + 1) : []));
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

  // No live file but in a workout: the choices from Zwift, and the one picked.
  const [choices, setChoices] = useState<WorkoutChoice[]>([]);
  const [raw, setRaw] = useState<unknown>(null);
  const [picked, setPicked] = useState<string | undefined>(() => loadPick());
  const needZwift = !example && !liveFile && !!zone;
  useEffect(() => {
    if (!needZwift) return;
    let live = true;
    void Promise.all([
      sauceRpc<unknown>(address, "getWorkoutSchedule").catch((e: Error) => ({ error: e.message })),
      sauceRpc<unknown>(address, "getWorkouts").catch((e: Error) => ({ error: e.message })),
    ]).then(([schedule, all]) => {
      if (!live) return;
      const day = today();
      const scheduled = workoutsIn(schedule).filter((w) => !w.date || w.date.slice(0, 10) === day);
      const seen = new Set<string>();
      const list: WorkoutChoice[] = [];
      for (const w of scheduled) if (!seen.has(w.id) && seen.add(w.id)) list.push({ id: w.id, name: w.name, scheduled: true });
      for (const w of workoutsIn(all).sort((a, b) => a.name.localeCompare(b.name)))
        if (!seen.has(w.id) && seen.add(w.id)) list.push({ id: w.id, name: w.name, scheduled: false });
      setChoices(list);
      setRaw({ schedule, workouts: Array.isArray(all) ? `${all.length} workouts` : all });
      // Just one planned for today: that's the one.
      const planned = list.filter((c) => c.scheduled);
      setPicked((p) => p ?? (planned.length === 1 ? planned[0].id : undefined));
    });
    return () => {
      live = false;
    };
  }, [address, needZwift]);

  const [pickedFile, setPickedFile] = useState<{ id: string; file: XmlNode | null } | null>(null);
  useEffect(() => {
    if (!needZwift || !picked || pickedFile?.id === picked) return;
    let live = true;
    void sauceRpc<unknown>(address, "getWorkout", picked)
      .then((w) => live && setPickedFile({ id: picked, file: fromSauceWorkout(w) }))
      .catch(() => live && setPickedFile({ id: picked, file: null }));
    return () => {
      live = false;
    };
  }, [address, needZwift, picked, pickedFile?.id]);

  const source: Workout["source"] = example ? "example" : liveFile ? "live" : needZwift && pickedFile?.file ? "zwift" : null;
  const file = source === "example" ? exampleFile : source === "live" ? liveFile : source === "zwift" ? pickedFile!.file : null;
  const plan = useMemo(() => parseWorkout(file, ftp ?? undefined), [file, ftp]);
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
    picked,
    pick: (id: string) => {
      savePick(id);
      setPicked(id);
    },
    raw: source === "live" ? status : { status, zwift: raw, progress, zone },
  };
}
