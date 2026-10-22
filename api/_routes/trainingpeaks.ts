import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSessionEmail } from "../_lib/session.js";
import { getJSON, setJSON } from "../_lib/kvStore.js";
import {
  fetchTrainingPeaksAtp,
  fetchTrainingPeaksAtpSample,
  fetchTrainingPeaksFitness,
  fetchTrainingPeaksWorkouts,
  fetchTrainingPeaksWorkoutsBetween,
  hasTrainingPeaksCookie,
  setTrainingPeaksCookie,
  TrainingPeaksAuthError,
  type TpAtpWeek,
  type TpFitnessPoint,
  type TpWorkout,
} from "../_lib/trainingPeaks.js";

/**
 * TrainingPeaks as the source of truth.
 *
 * Everywhere the two disagree, this wins: TrainingPeaks holds the athlete's
 * real CTL/ATL/TSB (computed from every workout, not just the Strava rides
 * with power this app can see), the real Annual Training Plan (rather than the
 * copy typed into atpPlan.ts), and real planned TSS (rather than the estimate
 * derived from a session's title and length). The app's own figures stay as
 * the fallback for when this is unavailable, not as a competing answer.
 *
 * The credential is write-only. It is a long-lived session cookie for the
 * athlete's entire TrainingPeaks account, so it goes in and is never read back
 * out - the GET reports only whether one is present and whether it still
 * works.
 */

const CACHE_KEY = "TRAININGPEAKS_DATA_CACHE";
// TrainingPeaks recomputes fitness as workouts land, but not minute to minute,
// and every request here costs a token exchange plus three calls.
const CACHE_MS = 15 * 60 * 1000;

export type TrainingPeaksData = {
  configured: boolean;
  fitness: TpFitnessPoint[];
  atp: TpAtpWeek[];
  workouts: TpWorkout[];
  fetchedAt?: number;
  /** Set when the stored cookie needs replacing, so the UI can say so plainly. */
  authExpired?: boolean;
  error?: string;
  /** The workouts could not be read, so an empty list says nothing about the plan. */
  workoutsUnavailable?: boolean;
};

type Cached = { fetchedAt: number; data: Omit<TrainingPeaksData, "configured"> };

/** After the coach changes the plan, so the next read shows the change. */
export async function forgetTrainingPeaksCache(): Promise<void> {
  await setJSON(CACHE_KEY, null).catch(() => {});
}

export async function fetchTrainingPeaksData(force = false): Promise<TrainingPeaksData> {
  if (!(await hasTrainingPeaksCookie())) {
    return { configured: false, fitness: [], atp: [], workouts: [] };
  }

  const cached = await getJSON<Cached>(CACHE_KEY).catch(() => null);
  if (cached && !force && Date.now() - cached.fetchedAt < CACHE_MS) {
    return { configured: true, ...cached.data, fetchedAt: cached.fetchedAt };
  }

  try {
    // One token exchange serves all three; they are independent otherwise, so
    // a failure in one should not cost the other two.
    const failures: unknown[] = [];
    const attempt = <T,>(work: Promise<T>) =>
      work.catch((error: unknown) => {
        failures.push(error);
        return null;
      });
    const [fitness, atp, workouts] = await Promise.all([
      attempt(fetchTrainingPeaksFitness()),
      attempt(fetchTrainingPeaksAtp()),
      attempt(fetchTrainingPeaksWorkouts()),
    ]);
    // A rejected cookie fails all three. Swallowed one by one, that read as
    // a connected account with nothing planned - and the coach told the
    // athlete so.
    const authFailure = failures.find((error) => error instanceof TrainingPeaksAuthError);
    if (authFailure) throw authFailure;

    const data = { fitness: fitness ?? [], atp: atp ?? [], workouts: workouts ?? [] };
    const fetchedAt = Date.now();
    if (failures.length > 0) {
      // Not cached: an empty list here means "couldn't read", not "nothing
      // planned", and should be retried on the next request.
      // One bad token exchange fails all three reads the same way.
      const error = [...new Set(failures.map((e) => (e instanceof Error ? e.message : String(e))))].join("; ");
      console.error("TrainingPeaks read partly failed", error);
      return { configured: true, ...data, fetchedAt, error, workoutsUnavailable: workouts == null };
    }
    await setJSON(CACHE_KEY, { fetchedAt, data } satisfies Cached).catch(() => {});
    return { configured: true, ...data, fetchedAt };
  } catch (error) {
    // An expired cookie is the one failure the athlete can actually fix, so it
    // is reported as itself rather than as a generic outage.
    if (error instanceof TrainingPeaksAuthError) {
      return { configured: true, fitness: [], atp: [], workouts: [], authExpired: true, error: error.message };
    }
    // Anything else: a stale copy beats nothing, since fitness moves slowly.
    if (cached) {
      return { configured: true, ...cached.data, fetchedAt: cached.fetchedAt, error: String(error) };
    }
    return { configured: true, fitness: [], atp: [], workouts: [], error: String(error) };
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function workoutsBetween(from: string | null, to: string | null) {
  if (!from || !to || !DATE.test(from) || !DATE.test(to)) {
    return { configured: true, workouts: [], workoutsUnavailable: true, error: "Expected from and to as YYYY-MM-DD." };
  }
  if (!(await hasTrainingPeaksCookie())) return { configured: false, workouts: [] };
  try {
    return { configured: true, workouts: (await fetchTrainingPeaksWorkoutsBetween(from, to)) ?? [] };
  } catch (error) {
    if (error instanceof TrainingPeaksAuthError) return { configured: true, authExpired: true, workouts: [] };
    console.error("TrainingPeaks range read failed", error);
    return { configured: true, workouts: [], workoutsUnavailable: true, error: error instanceof Error ? error.message : String(error) };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!getSessionEmail(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (req.method === "POST") {
    const body = (req.body ?? {}) as { cookie?: string | null };
    await setTrainingPeaksCookie(body.cookie ?? null);
    // Prove it works now rather than letting it fail silently later.
    const data = await fetchTrainingPeaksData(true);
    res.status(200).json({
      ok: true,
      configured: data.configured,
      authExpired: data.authExpired,
      error: data.error,
      counts: { fitness: data.fitness.length, atp: data.atp.length, workouts: data.workouts.length },
    });
    return;
  }

  // The plan exactly as TrainingPeaks sends it, for checking which fields it
  // carries. Signed-in only, like everything else here.
  if (req.query.atpSample === "1") {
    try {
      res.status(200).json({ sample: await fetchTrainingPeaksAtpSample() });
    } catch (error) {
      res.status(200).json({ error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  // A date range asks for just that span's workouts - the planned-vs-actual
  // widget's window, which can reach well past the cached seven weeks.
  const from = typeof req.query.from === "string" ? req.query.from : null;
  const to = typeof req.query.to === "string" ? req.query.to : null;
  if (from || to) {
    res.setHeader("Cache-Control", "private, max-age=300");
    res.status(200).json(await workoutsBetween(from, to));
    return;
  }

  const data = await fetchTrainingPeaksData(req.query.refresh === "1");
  res.setHeader("Cache-Control", "private, max-age=300");
  res.status(200).json(data);
}
