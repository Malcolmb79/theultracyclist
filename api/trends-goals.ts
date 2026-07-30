import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getJSON, setJSON } from "./_lib/kvStore.js";
import { getSessionEmail } from "./_lib/session.js";

export type Goals = {
  weightKg?: number;
  /** When the weight target is meant to be reached — ISO date. */
  weightTargetDate?: string;
  sleepHours?: number;
  /** Functional threshold power aimed for, in watts. */
  ftpTargetWatts?: number;
  /** When the FTP target is meant to be reached — ISO date. */
  ftpTargetDate?: string;
  proteinG?: number;
  fatG?: number;
  carbsG?: number;
  calorieGoalTrainingDay?: number;
  calorieGoalRestDay?: number;
};

const KV_KEY = "PERFORMANCE_GOALS";

// One-time migration fallback - see dashboard-layout.ts for why.
function readLegacyGoals(): Goals {
  try {
    const raw = process.env.PERFORMANCE_GOALS;
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Goals) : {};
  } catch {
    return {};
  }
}

// In-process accessor, same record the GET route serves. The coach needs the
// targets to answer anything shaped like "how am I tracking" - without them it
// had the athlete's weight but no idea what it was meant to be, and asked for
// numbers already stored here.
export async function fetchGoals(): Promise<Goals> {
  return (await getJSON<Goals>(KV_KEY)) ?? readLegacyGoals();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!getSessionEmail(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (req.method === "POST") {
    const goals = (req.body ?? {}) as Goals;
    await setJSON(KV_KEY, goals);
    res.status(200).json({ ok: true });
    return;
  }

  const goals = (await getJSON<Goals>(KV_KEY)) ?? readLegacyGoals();
  res.status(200).json({ goals });
}
