import type { VercelRequest, VercelResponse } from "@vercel/node";
import { persistEnvVar, triggerDeployHook } from "./_lib/vercelEnvStore.js";
import { getSessionEmail } from "./_lib/session.js";

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

// Vercel's decrypt=true for a personal access token doesn't reliably signal
// failure - a var it can't actually decrypt can come back looking like
// valid (empty-ish) data rather than erroring, so there's no safe way to
// tell "genuinely empty" apart from "failed to read" by inspecting the
// value. Reading straight from process.env (this deployment's build-time
// snapshot) is less fresh but never silently fabricates an empty layout -
// a page load can occasionally lag behind the very latest save until the
// deploy hook below lands, but it can never show *nothing* when there's
// real saved data. Given the choice, staleness beats data loss.
function readLayout(): Widget[] {
  try {
    const raw = process.env.DASHBOARD_LAYOUT;
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Widget[]) : [];
  } catch {
    return [];
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!getSessionEmail(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (req.method === "POST") {
    const widgets = (req.body as { widgets?: Widget[] }).widgets ?? [];
    await persistEnvVar("DASHBOARD_LAYOUT", JSON.stringify(widgets));
    await triggerDeployHook();
    res.status(200).json({ ok: true });
    return;
  }

  res.status(200).json({ widgets: readLayout() });
}
