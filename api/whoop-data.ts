import type { VercelRequest, VercelResponse } from "@vercel/node";

const TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
const API_BASE = "https://api.prod.whoop.com/developer/v2";
const VERCEL_API_BASE = "https://api.vercel.com";

type WhoopTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

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

    const data = (await listRes.json()) as { envs: { id: string; key: string }[] };
    const envVar = data.envs.find((e) => e.key === "WHOOP_REFRESH_TOKEN");
    if (!envVar) {
      console.error("WHOOP_REFRESH_TOKEN env var not found in Vercel project");
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
  score_state: string;
  score?: {
    recovery_score: number;
    hrv_rmssd_milli: number;
    resting_heart_rate: number;
  };
};

type WhoopCycleRecord = {
  score_state: string;
  score?: {
    strain: number;
    average_heart_rate: number;
    max_heart_rate: number;
  };
};

type WhoopSleepRecord = {
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
      fetch(`${API_BASE}/recovery?limit=1`, { headers: authHeader }),
      fetch(`${API_BASE}/cycle?limit=1`, { headers: authHeader }),
      fetch(`${API_BASE}/activity/sleep?limit=1`, { headers: authHeader }),
    ]);

    if (!recoveryRes.ok || !cycleRes.ok || !sleepRes.ok) {
      throw new Error(
        `Whoop fetch failed: recovery=${recoveryRes.status} cycle=${cycleRes.status} sleep=${sleepRes.status}`,
      );
    }

    const recoveryData = (await recoveryRes.json()) as WhoopCollection<WhoopRecoveryRecord>;
    const cycleData = (await cycleRes.json()) as WhoopCollection<WhoopCycleRecord>;
    const sleepData = (await sleepRes.json()) as WhoopCollection<WhoopSleepRecord>;

    const recoveryRecord = recoveryData.records[0];
    const recovery: Recovery | null = recoveryRecord?.score_state === "SCORED" && recoveryRecord.score
      ? {
          score: Math.round(recoveryRecord.score.recovery_score),
          hrvMs: Math.round(recoveryRecord.score.hrv_rmssd_milli),
          restingHeartRate: Math.round(recoveryRecord.score.resting_heart_rate),
        }
      : null;

    const cycleRecord = cycleData.records[0];
    const strain: Strain | null = cycleRecord?.score_state === "SCORED" && cycleRecord.score
      ? {
          score: Math.round(cycleRecord.score.strain * 10) / 10,
          avgHeartRate: Math.round(cycleRecord.score.average_heart_rate),
          maxHeartRate: Math.round(cycleRecord.score.max_heart_rate),
        }
      : null;

    const sleepRecord = sleepData.records[0];
    const sleep: Sleep | null = sleepRecord?.score_state === "SCORED" && sleepRecord.score
      ? {
          performancePercent: Math.round(sleepRecord.score.sleep_performance_percentage),
          totalSleepHours: Math.round(
            (sleepRecord.score.stage_summary.total_light_sleep_time_milli +
              sleepRecord.score.stage_summary.total_slow_wave_sleep_time_milli +
              sleepRecord.score.stage_summary.total_rem_sleep_time_milli) / 3600000 * 10,
          ) / 10,
          lightHours: Math.round(sleepRecord.score.stage_summary.total_light_sleep_time_milli / 3600000 * 10) / 10,
          deepHours: Math.round(sleepRecord.score.stage_summary.total_slow_wave_sleep_time_milli / 3600000 * 10) / 10,
          remHours: Math.round(sleepRecord.score.stage_summary.total_rem_sleep_time_milli / 3600000 * 10) / 10,
        }
      : null;

    res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=3600");
    res.status(200).json({ recovery, strain, sleep });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: "Unable to load Whoop data" });
  }
}
