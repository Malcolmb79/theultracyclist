import type { VercelRequest, VercelResponse } from "@vercel/node";
import { persistEnvVar, triggerDeployHook } from "./_lib/vercelEnvStore.js";
import { getSessionEmail } from "./_lib/session.js";

type CoachingWidgetRect = { x: number; y: number; width: number; height: number };

// Mirrors dashboard's Widget type (src/components/dashboard/types.ts) -
// independent local copy, matching how this project keeps the frontend and
// api/ TypeScript projects decoupled (see coaching-narrative.ts's
// NarrativeInput for the same pattern).
type CatalogWidget = {
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

export type CoachingSettings = {
  ftpWatts?: number;
  weeklyDistanceKm?: number;
  weeklyHours?: number;
  phase?: "build" | "recovery" | "taper";
  layout?: Partial<Record<"readiness" | "chat" | "trainingPlan" | "powerZones", CoachingWidgetRect>>;
  widgets?: CatalogWidget[];
};

function readSettings(): CoachingSettings {
  try {
    const raw = process.env.COACHING_SETTINGS;
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as CoachingSettings) : {};
  } catch {
    return {};
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!getSessionEmail(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (req.method === "POST") {
    const settings = (req.body ?? {}) as CoachingSettings;
    await persistEnvVar("COACHING_SETTINGS", JSON.stringify(settings));
    await triggerDeployHook();
    res.status(200).json({ ok: true });
    return;
  }

  res.status(200).json({ settings: readSettings() });
}
