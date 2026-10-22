import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSessionEmail } from "../_lib/session.js";
import { COACH_BASELINE_KEY, getCoachBaseline, planSections, type CoachBaseline } from "../_lib/coachBaseline.js";
import { setJSON } from "../_lib/kvStore.js";

// Loads the athlete's training plan as the coach's baseline (see
// _lib/coachBaseline.ts). Written by a trusted sender with the ingest secret,
// like the Garmin sync; read back by the signed-in athlete.

const MAX_RULES = 20_000;
const MAX_DOCUMENT = 200_000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "POST") {
    const secret = process.env.APPLE_HEALTH_WEBHOOK_SECRET;
    if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const body = req.body as Partial<CoachBaseline> | undefined;
    if (
      typeof body?.title !== "string" ||
      typeof body.rules !== "string" ||
      typeof body.document !== "string" ||
      !body.rules.trim() ||
      body.rules.length > MAX_RULES ||
      body.document.length > MAX_DOCUMENT
    ) {
      res.status(400).json({ error: "Expected { title, rules, document }" });
      return;
    }
    const baseline: CoachBaseline = {
      title: body.title.slice(0, 200),
      rules: body.rules,
      document: body.document,
      updatedAt: new Date().toISOString(),
    };
    if (!(await setJSON(COACH_BASELINE_KEY, baseline))) {
      res.status(503).json({ error: "Storage unavailable" });
      return;
    }
    res.status(200).json({ ok: true, sections: planSections(baseline.document).map((s) => `${s.id}. ${s.title}`) });
    return;
  }

  if (!getSessionEmail(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const baseline = await getCoachBaseline();
  res.status(200).json(
    baseline
      ? { title: baseline.title, rules: baseline.rules, updatedAt: baseline.updatedAt, sections: planSections(baseline.document).map((s) => `${s.id}. ${s.title}`) }
      : { title: null },
  );
}
