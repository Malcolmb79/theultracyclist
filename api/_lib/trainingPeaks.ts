import { getJSON, setJSON } from "./kvStore.js";
import { computeStructureSummary, type WorkoutStep, type WorkoutStepGroup } from "./plannedWorkouts.js";

/**
 * A minimal TrainingPeaks client, ported from the tp-mcp server's HTTP layer.
 *
 * TrainingPeaks has no personal API - it is partner-only, and they state that
 * access is not available for personal use - so this authenticates the same
 * unofficial way tp-mcp does: the athlete's own `Production_tpAuth` browser
 * cookie is exchanged for a short-lived OAuth token, which signs every
 * subsequent call. That is a private endpoint and can change without notice;
 * every caller here degrades to "not available" rather than breaking a page.
 *
 * Only what the coach needs is ported, not tp-mcp's 84 tools: three reads
 * that close the gaps the ICS calendar feed leaves (no TSS, 14 days ahead, no
 * ATP targets), and creating, changing and deleting planned workouts, so the
 * coach can adjust the plan itself.
 *
 * WHY THE COOKIE LIVES IN REDIS
 * tp-mcp keeps it in the OS keyring, which a serverless function cannot reach.
 * For the deployed coach to read TrainingPeaks at all, the credential has to
 * be somewhere the function can get to, and that means the same store as the
 * Strava tokens. It is a long-lived session credential for the
 * athlete's whole TrainingPeaks account, so it is never returned by any
 * endpoint, never logged, and never put in a prompt - see coaching-settings.ts,
 * which reports only whether one is present.
 */

const TP_API_BASE = "https://tpapi.trainingpeaks.com";
const TOKEN_ENDPOINT = "/users/v3/token";
const COOKIE_KEY = "TRAININGPEAKS_COOKIE";
const TOKEN_CACHE_KEY = "TRAININGPEAKS_TOKEN";
// tp-mcp refreshes a minute before expiry; the same margin keeps a token from
// dying mid-request here.
const EXPIRY_MARGIN_SECONDS = 60;
const UPSTREAM_TIMEOUT_MS = 8000;

type CachedToken = { accessToken: string; expiresAt: number; athleteId: number | null };

/**
 * The cookie value from whatever was pasted: the bare value, "Production_tpAuth=value",
 * or a whole Cookie request header copied from DevTools' Network tab.
 */
function tpAuthValue(pasted: string): string | null {
  const text = pasted.trim().replace(/^cookie:s*/i, "");
  const named = /(?:^|;s*)Production_tpAuth=([^;s]+)/.exec(text);
  const value = (named ? named[1] : text).replace(/^"|"$/g, "").trim();
  return value || null;
}

export async function setTrainingPeaksCookie(cookie: string | null): Promise<void> {
  await setJSON(COOKIE_KEY, cookie ? tpAuthValue(cookie) : null);
  // A new cookie invalidates whatever the old one bought.
  await setJSON(TOKEN_CACHE_KEY, null).catch(() => {});
}

export async function hasTrainingPeaksCookie(): Promise<boolean> {
  const cookie = await getJSON<string | null>(COOKIE_KEY).catch(() => null);
  return !!cookie;
}

/**
 * A live access token, exchanging the cookie for one only when needed.
 *
 * Cached in Redis rather than per-instance: every cold lambda exchanging its
 * own token would hammer the endpoint for no gain, and the token is valid for
 * an hour.
 */
async function getAccessToken(): Promise<{ token: string; athleteId: number | null } | null> {
  const cached = await getJSON<CachedToken>(TOKEN_CACHE_KEY).catch(() => null);
  if (cached?.accessToken && cached.expiresAt - EXPIRY_MARGIN_SECONDS > Date.now() / 1000) {
    return { token: cached.accessToken, athleteId: cached.athleteId };
  }

  const cookie = await getJSON<string | null>(COOKIE_KEY).catch(() => null);
  if (!cookie) return null;

  const response = await fetch(`${TP_API_BASE}${TOKEN_ENDPOINT}`, {
    method: "GET",
    headers: {
      Cookie: `Production_tpAuth=${cookie}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });

  if (response.status === 401) throw new TrainingPeaksAuthError("TrainingPeaks cookie has expired.");
  // TrainingPeaks answers a value it cannot decode at all - a partial copy,
  // or a different cookie - with a 500 rather than a 401.
  if (response.status === 500) {
    throw new Error(
      "TrainingPeaks could not read the stored cookie. It is usually an incomplete copy or a different cookie - copy Production_tpAuth again.",
    );
  }
  if (!response.ok) throw new Error(`TrainingPeaks token exchange failed (${response.status})`);

  const body = (await response.json()) as {
    success?: boolean;
    token?: { access_token?: string; expires_in?: number };
    user?: { userId?: number; personId?: number };
  };
  const accessToken = body.token?.access_token;
  if (!body.success || !accessToken) throw new Error("TrainingPeaks returned an unrecognised token response.");

  const next: CachedToken = {
    accessToken,
    expiresAt: Date.now() / 1000 + (body.token?.expires_in ?? 3600),
    athleteId: body.user?.personId ?? body.user?.userId ?? null,
  };
  await setJSON(TOKEN_CACHE_KEY, next).catch(() => {});
  return { token: next.accessToken, athleteId: next.athleteId };
}

/** The stored cookie no longer works - the athlete has to paste a fresh one. */
export class TrainingPeaksAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrainingPeaksAuthError";
  }
}

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<{ data: T; athleteId: number | null } | null> {
  const auth = await getAccessToken();
  if (!auth) return null;

  const response = await fetch(`${TP_API_BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${auth.token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });

  if (response.status === 401) throw new TrainingPeaksAuthError("TrainingPeaks rejected the stored credential.");
  if (!response.ok) throw new Error(`TrainingPeaks request failed (${response.status})`);
  // A DELETE answers with no body at all.
  const text = await response.text();
  return { data: (text ? JSON.parse(text) : null) as T, athleteId: auth.athleteId };
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysFromToday(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return iso(date);
}

export type TpFitnessPoint = { date: string; ctl: number | null; atl: number | null; tsb: number | null; tss: number | null };

/**
 * TrainingPeaks' own CTL/ATL/TSB.
 *
 * The app computes these from Strava rides with power only, deliberately, so
 * the two disagree - 12 here against 20 there on the day this was written.
 * Having both means the coach can say which it is quoting instead of implying
 * one authoritative number.
 */
export async function fetchTrainingPeaksFitness(days = 90): Promise<TpFitnessPoint[] | null> {
  const auth = await getAccessToken();
  if (!auth?.athleteId) return null;

  const result = await call<Record<string, unknown>[]>(
    `/fitness/v1/athletes/${auth.athleteId}/reporting/performancedata/${daysFromToday(-days)}/${iso(new Date())}`,
    // The constants are TrainingPeaks' own defaults; sending them keeps this
    // reading the same curve the athlete sees in their app.
    { method: "POST", body: { atlConstant: 7, atlStart: 0, ctlConstant: 42, ctlStart: 0, workoutTypes: [] } },
  );
  if (!result) return null;

  const rows = Array.isArray(result.data) ? result.data : [];
  return rows.map((row) => {
    const r = row as Record<string, number | string | null>;
    return {
      date: String(r.workoutDay ?? r.date ?? "").slice(0, 10),
      ctl: numberOrNull(r.ctl),
      atl: numberOrNull(r.atl),
      tsb: numberOrNull(r.tsb),
      tss: numberOrNull(r.tssActual ?? r.tss),
    };
  });
}

export type TpAtpWeek = { weekStart: string; tssTarget: number | null; ctlTarget: number | null; tsbTarget: number | null };

/** The real Annual Training Plan, rather than the copy typed into atpPlan.ts. */
export async function fetchTrainingPeaksAtp(weeksAhead = 26): Promise<TpAtpWeek[] | null> {
  const auth = await getAccessToken();
  if (!auth?.athleteId) return null;

  const result = await call<Record<string, unknown>>(
    `/fitness/v1/athletes/${auth.athleteId}/atp/${daysFromToday(-7)}/${daysFromToday(weeksAhead * 7)}`,
  );
  if (!result) return null;

  const payload = result.data as { weeks?: Record<string, unknown>[] } | Record<string, unknown>[];
  const weeks = Array.isArray(payload) ? payload : (payload.weeks ?? []);
  return weeks.map((week) => {
    const w = week as Record<string, number | string | null>;
    return {
      weekStart: String(w.weekStartDate ?? w.startDate ?? "").slice(0, 10),
      tssTarget: numberOrNull(w.targetTss ?? w.plannedTss ?? w.tss),
      ctlTarget: numberOrNull(w.targetCtl ?? w.ctl),
      tsbTarget: numberOrNull(w.targetTsb ?? w.tsb),
    };
  });
}

export type TpWorkout = {
  /** TrainingPeaks' workout id - what changing or deleting it takes. */
  id: string | null;
  date: string;
  title: string;
  sport: string | null;
  plannedTss: number | null;
  plannedMinutes: number | null;
  completed: boolean;
};

/**
 * Planned and completed workouts, without the calendar feed's ceilings.
 *
 * The ICS feed reaches 14 days ahead and carries no TSS. This carries both,
 * which is the whole reason for going past it.
 */
export async function fetchTrainingPeaksWorkouts(daysBack = 7, daysAhead = 42): Promise<TpWorkout[] | null> {
  const auth = await getAccessToken();
  if (!auth?.athleteId) return null;

  const result = await call<Record<string, unknown>[]>(
    `/fitness/v6/athletes/${auth.athleteId}/workouts/${daysFromToday(-daysBack)}/${daysFromToday(daysAhead)}`,
  );
  if (!result) return null;

  const rows = Array.isArray(result.data) ? result.data : [];
  const workouts = rows.map((row) => {
    const w = row as Record<string, number | string | null | boolean>;
    return {
      id: w.workoutId != null ? String(w.workoutId) : null,
      date: String(w.workoutDay ?? w.startDate ?? "").slice(0, 10),
      title: String(w.title ?? w.description ?? "Workout"),
      sport: w.workoutTypeValueId != null ? String(w.workoutTypeValueId) : null,
      plannedTss: numberOrNull(w.tssPlanned),
      plannedMinutes: (() => {
        const hours = numberOrNull(w.totalTimePlanned);
        return hours == null ? null : Math.round(hours * 60);
      })(),
      // A workout with recorded time actually happened; one with only a plan
      // has not.
      completed: numberOrNull(w.totalTime) != null,
    };
  });
  return workouts.sort((a, b) => a.date.localeCompare(b.date));
}

function numberOrNull(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}

// --- Writing planned workouts -------------------------------------------
// Ported from tp-mcp's tp_create_workout / tp_update_workout /
// tp_delete_workout and its structure builder.

/** Sport name -> (workoutTypeFamilyId, workoutTypeValueId), from GET /fitness/v6/workouttypes. */
export const TP_SPORTS = {
  Bike: 2,
  Run: 3,
  Swim: 1,
  Strength: 9,
  Walk: 13,
  MtnBike: 8,
  Crosstrain: 5,
  DayOff: 7,
  Other: 100,
} as const;
export type TpSport = keyof typeof TP_SPORTS;

export type TpWorkoutInput = {
  /** YYYY-MM-DD, or YYYY-MM-DDTHH:MM:SS for a planned start time. */
  date: string;
  sport: TpSport;
  title: string;
  description?: string;
  primaryIntensityMetric?: "percentOfFtp" | "percentOfThresholdHr";
  steps?: WorkoutStepGroup[];
  durationMinutes?: number;
  tssPlanned?: number;
};

function stepWire(step: WorkoutStep) {
  return {
    name: step.name ?? "Step",
    type: "step",
    length: { value: step.durationSeconds, unit: "second" },
    targets: step.intensityMin != null ? [{ minValue: step.intensityMin, maxValue: step.intensityMax ?? step.intensityMin }] : [],
    intensityClass: step.intensityClass ?? "active",
    openDuration: false,
  };
}

/** TrainingPeaks' own structure format: blocks with begin/end offsets, plus the bar-chart polyline its calendar draws. */
export function trainingPeaksStructure(steps: WorkoutStepGroup[], metric: "percentOfFtp" | "percentOfThresholdHr") {
  const blockSeconds = (g: WorkoutStepGroup) =>
    g.type === "repetition" ? g.steps.reduce((sum, s) => sum + s.durationSeconds, 0) * g.reps : g.durationSeconds;
  const total = steps.reduce((sum, g) => sum + blockSeconds(g), 0);
  let cursor = 0;
  const blocks = steps.map((g) => {
    const begin = cursor;
    cursor += blockSeconds(g);
    return g.type === "repetition"
      ? { type: "repetition", length: { value: g.reps, unit: "repetition" }, steps: g.steps.map(stepWire), begin, end: cursor }
      : { type: "step", length: { value: 1, unit: "repetition" }, steps: [stepWire(g)], begin, end: cursor };
  });

  const polyline: number[][] = [];
  let elapsed = 0;
  const bar = (step: WorkoutStep) => {
    const start = total > 0 ? elapsed / total : 0;
    elapsed += step.durationSeconds;
    const end = total > 0 ? elapsed / total : 0;
    const height = (step.intensityMax ?? step.intensityMin ?? 0) / 100;
    const r = (v: number) => Math.round(v * 10000) / 10000;
    polyline.push([r(start), 0], [r(start), r(height)], [r(end), r(height)], [r(end), 0]);
  };
  for (const g of steps) {
    if (g.type === "repetition") for (let i = 0; i < g.reps; i++) g.steps.forEach(bar);
    else bar(g);
  }

  return {
    structure: blocks,
    polyline,
    primaryLengthMetric: "duration",
    primaryIntensityMetric: metric,
    primaryIntensityTargetOrRange: "range",
  };
}

function workoutDay(date: string): string {
  return `${date.slice(0, 10)}T00:00:00`;
}

function applyInput(target: Record<string, unknown>, input: Partial<TpWorkoutInput>) {
  if (input.sport) {
    target.workoutTypeFamilyId = TP_SPORTS[input.sport];
    target.workoutTypeValueId = TP_SPORTS[input.sport];
  }
  if (input.title != null) target.title = input.title;
  if (input.description != null) target.description = input.description;
  if (input.date) {
    target.workoutDay = workoutDay(input.date);
    if (input.date.length > 10) target.startTimePlanned = input.date;
    else if (typeof target.startTimePlanned === "string") {
      // Moving a workout with a start time keeps the time of day.
      target.startTimePlanned = `${input.date}${(target.startTimePlanned as string).slice(10)}`;
    }
  }
  const metric = input.primaryIntensityMetric ?? "percentOfFtp";
  const derived = input.steps?.length ? computeStructureSummary({ steps: input.steps, primaryIntensityMetric: metric }) : null;
  if (input.steps?.length) {
    target.structure = JSON.stringify(trainingPeaksStructure(input.steps, metric));
    if (derived && input.tssPlanned == null) target.ifPlanned = derived.ifPlanned;
    else delete target.ifPlanned;
  }
  const minutes = input.durationMinutes ?? derived?.durationMinutes;
  if (minutes != null) target.totalTimePlanned = minutes / 60;
  const tss = input.tssPlanned ?? derived?.tssPlanned;
  if (tss != null) target.tssPlanned = tss;
}

export type TpWriteResult = { id: string | null; date: string; title: string };

export async function createTrainingPeaksWorkout(input: TpWorkoutInput): Promise<TpWriteResult> {
  const auth = await getAccessToken();
  if (!auth?.athleteId) throw new Error("TrainingPeaks isn't connected.");
  const payload: Record<string, unknown> = { athleteId: auth.athleteId, isHidden: false };
  applyInput(payload, input);
  const result = await call<Record<string, unknown>>(`/fitness/v6/athletes/${auth.athleteId}/workouts`, { method: "POST", body: payload });
  return {
    id: result?.data?.workoutId != null ? String(result.data.workoutId) : null,
    date: input.date,
    title: input.title,
  };
}

async function existingWorkout(id: string): Promise<{ athleteId: number; workout: Record<string, unknown> }> {
  if (!/^\d+$/.test(id)) throw new Error(`"${id}" is not a TrainingPeaks workout id.`);
  const auth = await getAccessToken();
  if (!auth?.athleteId) throw new Error("TrainingPeaks isn't connected.");
  const result = await call<Record<string, unknown>>(`/fitness/v6/athletes/${auth.athleteId}/workouts/${id}`);
  if (!result?.data || typeof result.data !== "object") throw new Error(`No TrainingPeaks workout ${id}.`);
  // A workout with recorded time already happened; its record is the athlete's, not the plan's.
  if (result.data.totalTime != null) throw new Error("That workout has already been completed - only planned workouts can be changed.");
  return { athleteId: auth.athleteId, workout: result.data };
}

export async function updateTrainingPeaksWorkout(id: string, patch: Partial<TpWorkoutInput>): Promise<TpWriteResult> {
  const { athleteId, workout } = await existingWorkout(id);
  applyInput(workout, patch);
  await call(`/fitness/v6/athletes/${athleteId}/workouts/${id}`, { method: "PUT", body: workout });
  return { id, date: String(workout.workoutDay ?? "").slice(0, 10), title: String(workout.title ?? "") };
}

export async function deleteTrainingPeaksWorkout(id: string): Promise<TpWriteResult> {
  const { athleteId, workout } = await existingWorkout(id);
  await call(`/fitness/v6/athletes/${athleteId}/workouts/${id}`, { method: "DELETE" });
  return { id, date: String(workout.workoutDay ?? "").slice(0, 10), title: String(workout.title ?? "") };
}
