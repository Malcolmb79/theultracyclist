import { getJSON, setJSON } from "./kvStore.js";

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
 * Only the three reads the coach actually needs are ported, not tp-mcp's 84
 * tools. Each one closes a gap the ICS calendar feed cannot: the feed carries
 * no TSS, reaches only 14 days ahead, and has no ATP targets at all.
 *
 * WHY THE COOKIE LIVES IN REDIS
 * tp-mcp keeps it in the OS keyring, which a serverless function cannot reach.
 * For the deployed coach to read TrainingPeaks at all, the credential has to
 * be somewhere the function can get to, and that means the same store as the
 * Whoop and Strava tokens. It is a long-lived session credential for the
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

export async function setTrainingPeaksCookie(cookie: string | null): Promise<void> {
  await setJSON(COOKIE_KEY, cookie && cookie.trim() ? cookie.trim() : null);
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
  return { data: (await response.json()) as T, athleteId: auth.athleteId };
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
  return rows.map((row) => {
    const w = row as Record<string, number | string | null | boolean>;
    return {
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
}

function numberOrNull(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}
