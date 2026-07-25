import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getJSON, setJSON } from "./_lib/kvStore.js";
import { getSessionEmail } from "./_lib/session.js";

export type Widget = {
  id: string;
  source: "strava" | "whoop" | "health";
  metric: string;
  label: string;
  viewType: "stat" | "chart" | "timeline" | "ring" | "combo" | "rings";
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  color?: string;
};

const KV_KEY = "DASHBOARD_LAYOUT";

// One-time migration fallback: this key used to live in a Vercel project
// env var (only visible after a redeploy - see _lib/vercelEnvStore.ts for
// why that caused lost updates). Until the first post-migration save lands
// in Redis, fall back to whatever's still in the env var so nothing saved
// before the cutover disappears.
function readLegacyLayout(): Widget[] {
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
    await setJSON(KV_KEY, widgets);
    res.status(200).json({ ok: true });
    return;
  }

  const widgets = (await getJSON<Widget[]>(KV_KEY)) ?? readLegacyLayout();
  res.status(200).json({ widgets });
}
