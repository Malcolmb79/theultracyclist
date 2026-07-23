import type { VercelRequest, VercelResponse } from "@vercel/node";

const TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
const API_BASE = "https://api.prod.whoop.com/developer/v2";
const VERCEL_API_BASE = "https://api.vercel.com";

type WhoopTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

// Whoop rotates the refresh token on every use. We can't read Vercel env var
// values back (the API's decrypt=true doesn't actually decrypt for personal
// access tokens), so process.env stays the read source for this deployment's
// lifetime, and each rotation is best-effort persisted back to Vercel via
// PATCH so the *next* deployment's cold start picks up the latest one.
async function persistRotatedRefreshToken(newRefreshToken: string): Promise<void> {
  const apiToken = process.env.VERCEL_API_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  const teamId = process.env.VERCEL_TEAM_ID;
  if (!apiToken || !projectId) return;

  try {
    const teamQuery = teamId ? `?teamId=${teamId}` : "";
    const listRes = await fetch(`${VERCEL_API_BASE}/v10/projects/${projectId}/env${teamQuery}`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    if (!listRes.ok) {
      console.error(`Failed to list Vercel env vars: ${listRes.status}`);
      return;
    }

    const data = (await listRes.json()) as { envs: { id: string; key: string; target: string[] | string }[] };
    const envVar = data.envs.find(
      (e) => e.key === "WHOOP_REFRESH_TOKEN" && (Array.isArray(e.target) ? e.target.includes("production") : e.target === "production"),
    );
    if (!envVar) {
      console.error("WHOOP_REFRESH_TOKEN (production) env var not found in Vercel project");
      return;
    }

    const patchRes = await fetch(`${VERCEL_API_BASE}/v9/projects/${projectId}/env/${envVar.id}${teamQuery}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ value: newRefreshToken }),
    });
    if (!patchRes.ok) {
      console.error(`Failed to update WHOOP_REFRESH_TOKEN: ${patchRes.status}`);
    }
  } catch (error) {
    console.error("Failed to persist rotated Whoop refresh token", error);
  }
}

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
    stage_summary: {
      total_light_sleep_time_milli: number;
      total_slow_wave_sleep_time_milli: number;
      total_rem_sleep_time_milli: number;
    };
  };
};

type WhoopCollection<T> = { records: T[] };

export type Recovery = { score: number; hrvMs: number; restingHeartRate: number };
export type Strain = { score: number; avgHeartRate: number; maxHeartRate: number };
export type Sleep = { performancePercent: number; totalSleepHours: number; lightHours: number; deepHours: number; remHours: number };

export type DaySummary = {
  date: string;
  recovery: Recovery | null;
  strain: Strain | null;
  sleep: Sleep | null;
};

const DAYS = 25; // Whoop's collection endpoints cap `limit` at 25.

function buildRecovery(record: WhoopRecoveryRecord | undefined): Recovery | null {
  return record?.score_state === "SCORED" && record.score
    ? {
        score: Math.round(record.score.recovery_score),
        hrvMs: Math.round(record.score.hrv_rmssd_milli),
        restingHeartRate: Math.round(record.score.resting_heart_rate),
      }
    : null;
}

function buildStrain(record: WhoopCycleRecord | undefined): Strain | null {
  return record?.score_state === "SCORED" && record.score
    ? {
        score: Math.round(record.score.strain * 10) / 10,
        avgHeartRate: Math.round(record.score.average_heart_rate),
        maxHeartRate: Math.round(record.score.max_heart_rate),
      }
    : null;
}

function buildSleep(record: WhoopSleepRecord | undefined): Sleep | null {
  return record?.score_state === "SCORED" && record.score
    ? {
        performancePercent: Math.round(record.score.sleep_performance_percentage),
        totalSleepHours: Math.round(
          (record.score.stage_summary.total_light_sleep_time_milli +
            record.score.stage_summary.total_slow_wave_sleep_time_milli +
            record.score.stage_summary.total_rem_sleep_time_milli) / 3600000 * 10,
        ) / 10,
        lightHours: Math.round(record.score.stage_summary.total_light_sleep_time_milli / 3600000 * 10) / 10,
        deepHours: Math.round(record.score.stage_summary.total_slow_wave_sleep_time_milli / 3600000 * 10) / 10,
        remHours: Math.round(record.score.stage_summary.total_rem_sleep_time_milli / 3600000 * 10) / 10,
      }
    : null;
}

let cachedToken: { accessToken: string; expiresAt: number } | null = null;
let currentRefreshToken: string | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - 60 > Date.now() / 1000) {
    return cachedToken.accessToken;
  }

  const clientId = process.env.WHOOP_CLIENT_ID;
  const clientSecret = process.env.WHOOP_CLIENT_SECRET;
  const refreshToken = currentRefreshToken ?? process.env.WHOOP_REFRESH_TOKEN;

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
  currentRefreshToken = data.refresh_token;

  if (data.refresh_token !== refreshToken) {
    await persistRotatedRefreshToken(data.refresh_token);
  }

  return cachedToken.accessToken;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const accessToken = await getAccessToken();
    const authHeader = { Authorization: `Bearer ${accessToken}` };

    const [recoveryRes, cycleRes, sleepRes] = await Promise.all([
      fetch(`${API_BASE}/recovery?limit=${DAYS}`, { headers: authHeader }),
      fetch(`${API_BASE}/cycle?limit=${DAYS}`, { headers: authHeader }),
      fetch(`${API_BASE}/activity/sleep?limit=${DAYS}`, { headers: authHeader }),
    ]);

    if (!recoveryRes.ok || !cycleRes.ok || !sleepRes.ok) {
      throw new Error(
        `Whoop fetch failed: recovery=${recoveryRes.status} cycle=${cycleRes.status} sleep=${sleepRes.status}`,
      );
    }

    const recoveryData = (await recoveryRes.json()) as WhoopCollection<WhoopRecoveryRecord>;
    const cycleData = (await cycleRes.json()) as WhoopCollection<WhoopCycleRecord>;
    const sleepData = (await sleepRes.json()) as WhoopCollection<WhoopSleepRecord>;

    const cyclesById = new Map(cycleData.records.map((c) => [c.id, c]));
    const sleepsById = new Map(sleepData.records.map((s) => [s.id, s]));

    const history: DaySummary[] = recoveryData.records.map((recoveryRecord) => {
      const cycleRecord = cyclesById.get(recoveryRecord.cycle_id);
      const sleepRecord = sleepsById.get(recoveryRecord.sleep_id);
      return {
        date: cycleRecord?.start ?? new Date().toISOString(),
        recovery: buildRecovery(recoveryRecord),
        strain: buildStrain(cycleRecord),
        sleep: buildSleep(sleepRecord),
      };
    });

    const latest = history[0] ?? { recovery: null, strain: null, sleep: null };

    res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=3600");
    res.status(200).json({ recovery: latest.recovery, strain: latest.strain, sleep: latest.sleep, history });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: "Unable to load Whoop data" });
  }
}
