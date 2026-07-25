import type { VercelRequest, VercelResponse } from "@vercel/node";
import { persistEnvVar, triggerDeployHook } from "./_lib/vercelEnvStore.js";

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

    const goals = (req.body ?? {}) as Goals;
    await persistEnvVar("PERFORMANCE_GOALS", JSON.stringify(goals));
    await triggerDeployHook();
    res.status(200).json({ ok: true });
    return;
  }

  res.status(200).json({ goals: readGoals() });
}
