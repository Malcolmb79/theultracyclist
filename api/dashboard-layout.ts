import type { VercelRequest, VercelResponse } from "@vercel/node";
import { persistEnvVar, readEnvVarLive } from "./_lib/vercelEnvStore.js";

export type Widget = {
  id: string;
  source: "strava" | "whoop" | "health";
  metric: string;
  label: string;
  viewType: "stat" | "chart" | "timeline" | "ring" | "combo" | "rings";
  width?: number;
  height?: number;
  color?: string;
};

function parseLayout(raw: string | null | undefined): Widget[] {
  try {
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Widget[]) : [];
  } catch {
    return [];
  }
}

// Reads the current layout. A saved layout can change many times within a
// single deployment's lifetime (every drag, resize, or add), so relying on
// process.env alone - a snapshot from this deployment's build - would mean
// a page refresh right after saving could show the layout from *before*
// that save, until the redeploy triggered by the save actually lands
// (which can take anywhere from seconds to tens of minutes). Read the
// live value from Vercel first and only fall back to process.env if that
// fails, so a refresh always reflects the most recent save.
async function readLayout(): Promise<Widget[]> {
  const live = await readEnvVarLive("DASHBOARD_LAYOUT");
  if (live != null) return parseLayout(live);
  return parseLayout(process.env.DASHBOARD_LAYOUT);
}

function isAuthorized(req: VercelRequest): boolean {
  const password = process.env.DASHBOARD_PASSWORD;
  const authHeader = req.headers.authorization;
  return Boolean(password) && authHeader === `Bearer ${password}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "POST") {
    if (!isAuthorized(req)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const widgets = (req.body as { widgets?: Widget[] }).widgets ?? [];
    // No triggerDeployHook() here on purpose: layout edits happen on every
    // drag/resize/click, far more often than something like a Whoop token
    // rotation, and readLayout() below already reads the live value
    // straight from Vercel rather than depending on a fresh deployment.
    // Forcing a redeploy per edit would only burn through Vercel's daily
    // deployment quota for no correctness benefit.
    await persistEnvVar("DASHBOARD_LAYOUT", JSON.stringify(widgets));
    res.status(200).json({ ok: true });
    return;
  }

  res.status(200).json({ widgets: await readLayout() });
}
