import type { VercelRequest, VercelResponse } from "@vercel/node";
import { persistEnvVar, triggerDeployHook } from "./_lib/vercelEnvStore.js";
import { getSessionEmail } from "./_lib/session.js";

export type Goals = {
  weightKg?: number;
  sleepHours?: number;
  proteinG?: number;
  fatG?: number;
  carbsG?: number;
  calorieGoalTrainingDay?: number;
  calorieGoalRestDay?: number;
};

function readGoals(): Goals {
  try {
    const raw = process.env.PERFORMANCE_GOALS;
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Goals) : {};
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
    const goals = (req.body ?? {}) as Goals;
    await persistEnvVar("PERFORMANCE_GOALS", JSON.stringify(goals));
    await triggerDeployHook();
    res.status(200).json({ ok: true });
    return;
  }

  res.status(200).json({ goals: readGoals() });
}
