import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyRaceCors, getRaceAuthEmail } from "../_lib/raceToken.js";
import { getJSON, setJSON } from "../_lib/kvStore.js";
import { zwiftGet, ZwiftApiUnavailable } from "../_lib/zwiftApi.js";

/**
 * Riders' Zwift Racing Score and category, for the mod's overlays. Sauce
 * loads other riders' profiles in bulk, and Zwift's bulk profiles leave the
 * racing score out; a rider's own profile has it. A few riders a call, one
 * after another, each kept for hours.
 *
 * GET ?ids=1,2,3 with the race key. Answers { configured, riders: { [id]: { racingScore, category } | null } }.
 */

const MAX_PER_CALL = 8;
const GAP_MS = 150;
const KEEP_MS = 6 * 60 * 60_000;

interface Profile {
  male?: boolean;
  competitionMetrics?: { racingScore?: number; category?: string; categoryWomen?: string };
}

type Score = { racingScore?: number; category?: string } | null;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyRaceCors(req, (name, value) => res.setHeader(name, value));
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (!getRaceAuthEmail(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  const ids = String(req.query.ids ?? "")
    .split(",")
    .map((x) => Number.parseInt(x, 10))
    .filter((x) => Number.isFinite(x) && x > 0)
    .slice(0, MAX_PER_CALL);
  const riders: Record<string, Score> = {};
  try {
    for (const id of ids) {
      const key = `zwift:rider-score:${id}`;
      const kept = await getJSON<{ at: number; value: Score }>(key);
      if (kept && Date.now() - kept.at < KEEP_MS) {
        riders[id] = kept.value;
        continue;
      }
      const p = await zwiftGet<Profile>(`/api/profiles/${id}`).catch(() => null);
      const m = p?.competitionMetrics;
      const value: Score = m?.racingScore != null ? { racingScore: Math.round(m.racingScore), category: (p?.male === false ? m.categoryWomen : m.category) ?? m.category } : null;
      riders[id] = value;
      await setJSON(key, { at: Date.now(), value });
      await new Promise((r) => setTimeout(r, GAP_MS));
    }
    res.status(200).json({ configured: true, riders });
  } catch (e) {
    if (e instanceof ZwiftApiUnavailable) {
      res.status(200).json({ configured: false, riders });
      return;
    }
    res.status(200).json({ configured: true, riders, error: e instanceof Error ? e.message : "Failed" });
  }
}
