const VERCEL_API_BASE = "https://api.vercel.com";

function teamQuery(): string {
  const teamId = process.env.VERCEL_TEAM_ID;
  return teamId ? `?teamId=${teamId}` : "";
}

// process.env is a snapshot taken at deployment/cold-start time, so writing
// a new value here only becomes process.env's read source once a fresh
// deployment happens (see triggerDeployHook) - callers must wait out the
// redeploy to read their own write. A live-read-via-decrypt=true approach
// was tried and reverted: Vercel's decrypt doesn't reliably signal failure
// for a personal access token, so a var it can't actually decrypt can come
// back looking like valid (empty) data instead of erroring, with no safe
// way to tell those two cases apart from the response alone. That's worse
// than staleness - it silently fabricated an empty dashboard layout in
// production. process.env + triggerDeployHook is slower but never lies.
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
