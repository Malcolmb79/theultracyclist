import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSessionEmail } from "./_lib/session.js";
import {
  listPlannedWorkouts,
  getPlannedWorkout,
  createPlannedWorkout,
  updatePlannedWorkout,
  deletePlannedWorkout,
  type PlannedWorkout,
} from "./_lib/plannedWorkouts.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!getSessionEmail(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const id = typeof req.query.id === "string" ? req.query.id : undefined;

  if (req.method === "GET") {
    if (id) {
      const workout = await getPlannedWorkout(id);
      if (!workout) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.status(200).json({ workout });
      return;
    }
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;
    const workouts = await listPlannedWorkouts(from, to);
    res.status(200).json({ workouts });
    return;
  }

  if (req.method === "POST") {
    const body = (req.body ?? {}) as Partial<PlannedWorkout>;
    if (!body.date || !body.sport || !body.title) {
      res.status(400).json({ error: "date, sport, and title are required" });
      return;
    }
    const workout = await createPlannedWorkout(body as Omit<PlannedWorkout, "id" | "createdAt" | "updatedAt">);
    res.status(200).json({ workout });
    return;
  }

  if (req.method === "PATCH") {
    if (!id) {
      res.status(400).json({ error: "id query param is required" });
      return;
    }
    const patch = (req.body ?? {}) as Partial<PlannedWorkout>;
    const workout = await updatePlannedWorkout(id, patch);
    if (!workout) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.status(200).json({ workout });
    return;
  }

  if (req.method === "DELETE") {
    if (!id) {
      res.status(400).json({ error: "id query param is required" });
      return;
    }
    const ok = await deletePlannedWorkout(id);
    if (!ok) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
