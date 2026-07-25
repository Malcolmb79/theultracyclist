import type { VercelRequest, VercelResponse } from "@vercel/node";
import { persistEnvVar, triggerDeployHook } from "./_lib/vercelEnvStore.js";
import { getSessionEmail } from "./_lib/session.js";

export type CoachingSettings = {
  ftpWatts?: number;
  weeklyDistanceKm?: number;
  weeklyHours?: number;
  phase?: "build" | "recovery" | "taper";
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
