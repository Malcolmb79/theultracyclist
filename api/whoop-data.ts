import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getJSON, setJSON } from "./_lib/kvStore.js";

const TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
const API_BASE = "https://api.prod.whoop.com/developer/v2";

type WhoopTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

type WhoopRecoveryRecord = {
  cycle_id: number;
  sleep_id: string;
  score_state: string;
  score?: {
    recovery_score: number;
    hrv_rmssd_milli: number;
    resting_heart_rate: number;
  };
};

type WhoopCycleRecord = {
  id: number;
  start: string;
  score_state: string;
  score?: {
    strain: number;
    average_heart_rate: number;
    max_heart_rate: number;
  };
};

type WhoopSleepRecord = {
  id: string;
  score_state: string;
  score?: {
    sleep_performance_percentage: number;
    sleep_consistency_percentage: number;
    sleep_efficiency_percentage: number;
    respiratory_rate: number;
    stage_summary: {
      total_light_sleep_time_milli: number;
      total_slow_wave_sleep_time_milli: number;
      total_rem_sleep_time_milli: number;
    };
    sleep_needed: {
      baseline_milli: number;
      need_from_sleep_debt_milli: number;
      need_from_recent_strain_milli: number;
      need_from_recent_nap_milli: number;
    };
  };
};

type WhoopWorkoutRecord = {
  id: string;
  start: string;
  score_state: string;
  score?: {
    zone_duration: {
      zone_zero_milli: number;
      zone_one_milli: number;
      zone_two_milli: number;
      zone_three_milli: number;
      zone_four_milli: number;
      zone_five_milli: number;
    };
  };
};

type WhoopCollection<T> = { records: T[]; next_token?: string | null };

export type Recovery = { score: number; hrvMs: number; restingHeartRate: number };
export type Strain = {
  score: number;
  avgHeartRate: number;
  maxHeartRate: number;
  zone1to3Minutes: number;
  zone4to5Minutes: number;
};
export type Sleep = {
  performancePercent: number;
  totalSleepHours: number;
  lightHours: number;
  deepHours: number;
  remHours: number;
  consistencyPercent: number;
  efficiencyPercent: number;
  hoursNeeded: number;
  respiratoryRate: number;
};

export type DaySummary = {
  date: string;
  recovery: Recovery | null;
  strain: Strain | null;
  sleep: Sleep | null;
};

export type WhoopHistoryResult = {
  recovery: Recovery | null;
  strain: Strain | null;
  sleep: Sleep | null;
  history: DaySummary[];
};

const DAYS = 25; // default window for the dashboard's own GET - Whoop's collection endpoints cap `limit` at 25 per page.
const PAGE_LIMIT = 25;

function buildRecovery(record: WhoopRecoveryRecord | undefined): Recovery | null {
  return record?.score_state === "SCORED" && record.score
    ? {
        score: Math.round(record.score.recovery_score),
        hrvMs: Math.round(record.score.hrv_rmssd_milli),
        restingHeartRate: Math.round(record.score.resting_heart_rate),
      }
    : null;
}

function buildStrain(record: WhoopCycleRecord | undefined, zoneMinutes: { zone1to3: number; zone4to5: number }): Strain | null {
  return record?.score_state === "SCORED" && record.score
    ? {
        score: Math.round(record.score.strain * 10) / 10,
        avgHeartRate: Math.round(record.score.average_heart_rate),
        maxHeartRate: Math.round(record.score.max_heart_rate),
        zone1to3Minutes: zoneMinutes.zone1to3,
        zone4to5Minutes: zoneMinutes.zone4to5,
      }
    : null;
}

function buildSleep(record: WhoopSleepRecord | undefined): Sleep | null {
  if (record?.score_state !== "SCORED" || !record.score) return null;
  const s = record.score;
  const hoursNeededMilli =
    s.sleep_needed.baseline_milli +
    s.sleep_needed.need_from_sleep_debt_milli +
    s.sleep_needed.need_from_recent_strain_milli +
    s.sleep_needed.need_from_recent_nap_milli;
  return {
    performancePercent: Math.round(s.sleep_performance_percentage),
    totalSleepHours: Math.round(
      (s.stage_summary.total_light_sleep_time_milli +
        s.stage_summary.total_slow_wave_sleep_time_milli +
        s.stage_summary.total_rem_sleep_time_milli) / 3600000 * 10,
    ) / 10,
    lightHours: Math.round(s.stage_summary.total_light_sleep_time_milli / 3600000 * 10) / 10,
    deepHours: Math.round(s.stage_summary.total_slow_wave_sleep_time_milli / 3600000 * 10) / 10,
    remHours: Math.round(s.stage_summary.total_rem_sleep_time_milli / 3600000 * 10) / 10,
    consistencyPercent: Math.round(s.sleep_consistency_percentage),
    efficiencyPercent: Math.round(s.sleep_efficiency_percentage),
    hoursNeeded: Math.round((hoursNeededMilli / 3600000) * 10) / 10,
    respiratoryRate: Math.round(s.respiratory_rate * 10) / 10,
  };
}

// Whoop's zone_duration is per-workout; app-visible "Zone 1-5" labels map to
// the API's zone_one_milli..zone_five_milli (zone_zero is below the Zone 1
// threshold and isn't shown in the app's breakdown). Sum every workout that
// falls on a given calendar day to get that day's zone-3 vs zone 4-5 totals.
function zoneMinutesByDate(workouts: WhoopWorkoutRecord[]): Map<string, { zone1to3: number; zone4to5: number }> {
  const byDate = new Map<string, { zone1to3: number; zone4to5: number }>();
  for (const workout of workouts) {
    if (workout.score_state !== "SCORED" || !workout.score) continue;
    const date = workout.start.slice(0, 10);
    const z = workout.score.zone_duration;
    const zone1to3 = (z.zone_one_milli + z.zone_two_milli + z.zone_three_milli) / 60000;
    const zone4to5 = (z.zone_four_milli + z.zone_five_milli) / 60000;
    const existing = byDate.get(date) ?? { zone1to3: 0, zone4to5: 0 };
    byDate.set(date, { zone1to3: existing.zone1to3 + zone1to3, zone4to5: existing.zone4to5 + zone4to5 });
  }
  return byDate;
}

// Refresh tokens are single-use and rotate on every refresh - Redis (not the
// old persistEnvVar+redeploy pair) is what makes that safe. A redeploy only
// takes effect on its *next* build, so a token rotated between two nearby
// deploys could get orphaned by whichever deploy happened to bake in the
// older value, permanently dead-ending the refresh chain. Redis writes are
// immediately visible to every warm and cold lambda alike, so there's no
// window for that race.
const REFRESH_TOKEN_KEY = "WHOOP_REFRESH_TOKEN";

let cachedToken: { accessToken: string; expiresAt: number } | null = null;
let currentRefreshToken: string | null = null;

export async function persistWhoopRefreshToken(token: string): Promise<void> {
  currentRefreshToken = token;
  await setJSON(REFRESH_TOKEN_KEY, token);
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - 60 > Date.now() / 1000) {
    return cachedToken.accessToken;
  }

  const clientId = process.env.WHOOP_CLIENT_ID;
  const clientSecret = process.env.WHOOP_CLIENT_SECRET;
  // WHOOP_REFRESH_TOKEN env var is a one-time seed for first setup only -
  // once the flow below has rotated a token into Redis, that's the source
  // of truth from here on.
  const refreshToken = currentRefreshToken ?? (await getJSON<string>(REFRESH_TOKEN_KEY)) ?? process.env.WHOOP_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Whoop API credentials are not configured");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    scope: "offline",
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`Whoop token refresh failed: ${response.status}`);
  }

  const data = (await response.json()) as WhoopTokenResponse;
  cachedToken = { accessToken: data.access_token, expiresAt: Date.now() / 1000 + data.expires_in };
  await persistWhoopRefreshToken(data.refresh_token);

  return cachedToken.accessToken;
}

// Whoop's collection endpoints only return up to PAGE_LIMIT records per
// call, so a `days` window longer than that needs the `nextToken` cursor
// walked forward until the API stops returning more pages.
async function fetchCollection<T>(path: string, authHeader: HeadersInit, days: number): Promise<T[]> {
  const rangeStart = new Date(Date.now() - days * 86400000).toISOString();
  const records: T[] = [];
  let nextToken: string | undefined;
  const maxPages = Math.ceil(days / PAGE_LIMIT) + 1;

  for (let page = 0; page < maxPages; page++) {
    const url = new URL(`${API_BASE}${path}`);
    url.searchParams.set("limit", String(PAGE_LIMIT));
    url.searchParams.set("start", rangeStart);
    if (nextToken) url.searchParams.set("nextToken", nextToken);

    const res = await fetch(url.toString(), { headers: authHeader });
    if (!res.ok) throw new Error(`Whoop fetch failed: ${path}=${res.status}`);

    const data = (await res.json()) as WhoopCollection<T>;
    records.push(...data.records);

    if (!data.next_token || data.records.length === 0) break;
    nextToken = data.next_token;
  }

  return records;
}

export async function fetchWhoopHistory(days: number = DAYS): Promise<WhoopHistoryResult> {
  const accessToken = await getAccessToken();
  const authHeader = { Authorization: `Bearer ${accessToken}` };

  const [recoveryRecords, cycleRecords, sleepRecords, workoutRecords] = await Promise.all([
    fetchCollection<WhoopRecoveryRecord>("/recovery", authHeader, days),
    fetchCollection<WhoopCycleRecord>("/cycle", authHeader, days),
    fetchCollection<WhoopSleepRecord>("/activity/sleep", authHeader, days),
    // Heart-rate zone breakdown is a nice-to-have on top of the core scores -
    // if the workout fetch fails for any reason, degrade to zeroed zone
    // minutes rather than failing the whole request.
    fetchCollection<WhoopWorkoutRecord>("/activity/workout", authHeader, days).catch(() => [] as WhoopWorkoutRecord[]),
  ]);

  const cyclesById = new Map(cycleRecords.map((c) => [c.id, c]));
  const sleepsById = new Map(sleepRecords.map((s) => [s.id, s]));
  const zonesByDate = zoneMinutesByDate(workoutRecords);

  const history: DaySummary[] = recoveryRecords.map((recoveryRecord) => {
    const cycleRecord = cyclesById.get(recoveryRecord.cycle_id);
    const sleepRecord = sleepsById.get(recoveryRecord.sleep_id);
    const date = cycleRecord?.start ?? new Date().toISOString();
    const zoneMinutes = zonesByDate.get(date.slice(0, 10)) ?? { zone1to3: 0, zone4to5: 0 };
    return {
      date,
      recovery: buildRecovery(recoveryRecord),
      strain: buildStrain(cycleRecord, zoneMinutes),
      sleep: buildSleep(sleepRecord),
    };
  });

  const latest = history[0] ?? { recovery: null, strain: null, sleep: null };

  return { recovery: latest.recovery, strain: latest.strain, sleep: latest.sleep, history };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const result = await fetchWhoopHistory(DAYS);
    res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=3600");
    res.status(200).json(result);
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: "Unable to load Whoop data" });
  }
}
