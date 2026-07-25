import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getJSON, setJSON } from "./_lib/kvStore.js";
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
  // Free-text standing instructions the athlete sets once (dietary
  // restrictions, injuries, tone preferences, anything else) - folded into
  // every coach prompt (see buildSystemPrompt in coaching-chat.ts and
  // buildPrompt in coaching-narrative.ts) rather than needing to be repeated.
  customRules?: string;
};

const KV_KEY = "COACHING_SETTINGS";

// One-time migration fallback - see dashboard-layout.ts for why.
function readLegacySettings(): CoachingSettings {
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
    await setJSON(KV_KEY, settings);
    res.status(200).json({ ok: true });
    return;
  }

  const settings = (await getJSON<CoachingSettings>(KV_KEY)) ?? readLegacySettings();
  res.status(200).json({ settings });
}
