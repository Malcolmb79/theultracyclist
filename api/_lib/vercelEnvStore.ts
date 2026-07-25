const VERCEL_API_BASE = "https://api.vercel.com";

function teamQuery(): string {
  const teamId = process.env.VERCEL_TEAM_ID;
  return teamId ? `?teamId=${teamId}` : "";
}

// process.env is a snapshot taken at deployment/cold-start time, so writing
// a new value here only becomes process.env's read source once a fresh
// deployment happens (see triggerDeployHook). For "sensitive"-type vars,
// Vercel's decrypt=true never recovers the value (by design) so process.env
// is the only read path and callers must wait out the redeploy. For
// non-sensitive vars, readEnvVarLive() below can read the current value
// immediately without waiting on a deployment at all.
export async function persistEnvVar(key: string, value: string): Promise<void> {
  const apiToken = process.env.VERCEL_API_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (!apiToken || !projectId) return;

  try {
    const listRes = await fetch(`${VERCEL_API_BASE}/v10/projects/${projectId}/env${teamQuery()}`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    if (!listRes.ok) {
      console.error(`Failed to list Vercel env vars: ${listRes.status}`);
      return;
    }

    const data = (await listRes.json()) as { envs: { id: string; key: string; target: string[] | string }[] };
    const envVar = data.envs.find(
      (e) => e.key === key && (Array.isArray(e.target) ? e.target.includes("production") : e.target === "production"),
    );
    if (!envVar) {
      console.error(`${key} (production) env var not found in Vercel project`);
      return;
    }

    const patchRes = await fetch(`${VERCEL_API_BASE}/v9/projects/${projectId}/env/${envVar.id}${teamQuery()}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });
    if (!patchRes.ok) {
      console.error(`Failed to update ${key}: ${patchRes.status}`);
    }
  } catch (error) {
    console.error(`Failed to persist ${key}`, error);
  }
}

// Best-effort live read of a non-sensitive ("plain"/"encrypted" type, not
// "sensitive" type) env var straight from Vercel's API, bypassing the
// deployment-snapshot staleness that process.env has. Vercel's decrypt=true
// genuinely can't recover "sensitive"-type values (by design, write-only),
// but plain values do come back readable this way - useful for data that
// changes far more often than deployments do (e.g. dashboard layout edits),
// where waiting for a redeploy to see your own last write would mean a
// refresh in that window shows stale data. Returns null on any failure so
// callers can fall back to process.env.
export async function readEnvVarLive(key: string): Promise<string | null> {
  const apiToken = process.env.VERCEL_API_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (!apiToken || !projectId) return null;

  try {
    const decryptParam = teamQuery() ? "&decrypt=true" : "?decrypt=true";
    const listRes = await fetch(`${VERCEL_API_BASE}/v10/projects/${projectId}/env${teamQuery()}${decryptParam}`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    if (!listRes.ok) return null;

    const data = (await listRes.json()) as { envs: { key: string; value?: string; target: string[] | string }[] };
    const envVar = data.envs.find(
      (e) => e.key === key && (Array.isArray(e.target) ? e.target.includes("production") : e.target === "production"),
    );
    return envVar?.value ?? null;
  } catch {
    return null;
  }
}

// Env var changes only apply on the next deployment's cold start. Triggering
// the project's deploy hook makes a pushed value visible within a deploy
// cycle instead of waiting for the next unrelated code change.
export async function triggerDeployHook(): Promise<void> {
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
