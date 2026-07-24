import type { VercelRequest, VercelResponse } from "@vercel/node";
import { persistEnvVar, triggerDeployHook } from "./_lib/vercelEnvStore.js";

export type Widget = {
  id: string;
  source: "strava" | "whoop" | "health";
  metric: string;
  label: string;
  viewType: "stat" | "chart" | "timeline" | "ring" | "combo";
  width?: number;
  height?: number;
  color?: string;
};

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
    await persistEnvVar("DASHBOARD_LAYOUT", JSON.stringify(widgets));
    await triggerDeployHook();
    res.status(200).json({ ok: true });
    return;
  }

  res.status(200).json({ widgets: readLayout() });
}
