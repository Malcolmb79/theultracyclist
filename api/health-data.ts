import type { VercelRequest, VercelResponse } from "@vercel/node";

const VERCEL_API_BASE = "https://api.vercel.com";
const MAX_DAYS = 60;

export type HealthDay = {
  date: string;
  steps: number | null;
  vo2Max: number | null;
  weightKg: number | null;
};

function readHistory(): HealthDay[] {
  try {
    const raw = process.env.APPLE_HEALTH_HISTORY;
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HealthDay[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Same self-persisting pattern as api/whoop-data.ts: process.env is the read
// source for this deployment's lifetime, writes go back to Vercel via PATCH
// so the next deployment's cold start (and other warm instances, eventually)
// see the latest value.
async function persistHistory(history: HealthDay[]): Promise<void> {
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
      (e) => e.key === "APPLE_HEALTH_HISTORY" && (Array.isArray(e.target) ? e.target.includes("production") : e.target === "production"),
    );
    if (!envVar) {
      console.error("APPLE_HEALTH_HISTORY (production) env var not found in Vercel project");
      return;
    }

    const patchRes = await fetch(`${VERCEL_API_BASE}/v9/projects/${projectId}/env/${envVar.id}${teamQuery}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ value: JSON.stringify(history) }),
    });
    if (!patchRes.ok) {
      console.error(`Failed to update APPLE_HEALTH_HISTORY: ${patchRes.status}`);
    }
  } catch (error) {
    console.error("Failed to persist Apple Health history", error);
  }
}

// Env var changes only apply on the *next* deployment's cold start, so a
// pushed value wouldn't show up on the live site until an unrelated code
// change deploys. Triggering the project's deploy hook after a successful
// write makes each push visible within roughly a deploy cycle instead.
async function triggerRedeploy(): Promise<void> {
  const hookUrl = process.env.HEALTH_DATA_DEPLOY_HOOK_URL;
  if (!hookUrl) return;

  try {
    const res = await fetch(hookUrl, { method: "POST" });
    if (!res.ok) {
      console.error(`Deploy hook trigger failed: ${res.status}`);
    }
  } catch (error) {
    console.error("Failed to trigger deploy hook", error);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "POST") {
    const secret = process.env.APPLE_HEALTH_WEBHOOK_SECRET;
    const authHeader = req.headers.authorization;
    if (!secret || authHeader !== `Bearer ${secret}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // TEMPORARY: log just the metric names + one sample point each, so we
    // can confirm Health Auto Export's exact field names without flooding
    // the log with the full per-minute data arrays.
    const rawBody = req.body as { data?: { metrics?: { name: string; units: string; data: unknown[] }[] } };
    if (rawBody.data?.metrics) {
      console.log(
        "health-data metric names:",
        JSON.stringify(rawBody.data.metrics.map((m) => ({ name: m.name, units: m.units, sample: m.data[0] }))),
      );
    }

    const body = req.body as { date?: string; steps?: number; vo2Max?: number; weightKg?: number };
    const date = body.date ?? new Date().toISOString().slice(0, 10);

    const entry: HealthDay = {
      date,
      steps: typeof body.steps === "number" ? Math.round(body.steps) : null,
      vo2Max: typeof body.vo2Max === "number" ? Math.round(body.vo2Max * 10) / 10 : null,
      weightKg: typeof body.weightKg === "number" ? Math.round(body.weightKg * 10) / 10 : null,
    };

    const history = readHistory();
    const existingIndex = history.findIndex((d) => d.date === date);
    if (existingIndex >= 0) {
      history[existingIndex] = { ...history[existingIndex], ...entry };
    } else {
      history.unshift(entry);
    }
    history.sort((a, b) => (a.date < b.date ? 1 : -1));
    const trimmed = history.slice(0, MAX_DAYS);

    await persistHistory(trimmed);
    await triggerRedeploy();

    res.status(200).json({ ok: true, entry });
    return;
  }

  const history = readHistory();
  res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=3600");
  res.status(200).json({ history });
}
