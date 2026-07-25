import type { VercelRequest, VercelResponse } from "@vercel/node";
import { persistEnvVar, triggerDeployHook } from "./_lib/vercelEnvStore.js";
import { getSessionEmail } from "./_lib/session.js";

export type TrendsWidget = {
  id: string;
  metric: string;
  label: string;
  viewType: "day" | "week" | "month" | "calendar";
  color?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

function readLayout(): TrendsWidget[] {
  try {
    const raw = process.env.TRENDS_LAYOUT;
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as TrendsWidget[]) : [];
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
    const widgets = (req.body as { widgets?: TrendsWidget[] }).widgets ?? [];
    await persistEnvVar("TRENDS_LAYOUT", JSON.stringify(widgets));
    await triggerDeployHook();
    res.status(200).json({ ok: true });
    return;
  }

  res.status(200).json({ widgets: readLayout() });
}
