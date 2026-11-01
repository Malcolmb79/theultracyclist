import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyRaceCors, getRaceAuthEmail } from "../_lib/raceToken.js";
import { getJSON, setJSON } from "../_lib/kvStore.js";
import { zwiftGet, ZwiftApiUnavailable } from "../_lib/zwiftApi.js";

/**
 * The rider's Zwift level, how far through it, and Drops - what Zwift's HUD
 * shows beside the ride stats, which Sauce doesn't carry - from their Zwift
 * profile, for the mod's Ride stats overlay. Zwift updates them when it
 * saves the ride (every few minutes), so they're kept here for a minute.
 *
 * GET, with the race key. Answers { configured, level, levelPct, drops, xp, targetXp }.
 */

const CACHE_KEY = "zwift:profile-summary";
const CACHE_MS = 60_000;

interface Profile {
  achievementLevel?: number;
  totalGold?: number;
  totalExperiencePoints?: number;
  targetExperiencePoints?: number;
}

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
  const cached = await getJSON<{ at: number; value: unknown }>(CACHE_KEY);
  if (cached && Date.now() - cached.at < CACHE_MS) {
    res.status(200).json(cached.value);
    return;
  }
  try {
    const p = await zwiftGet<Profile>("/api/profiles/me");
    // achievementLevel is the level times 100, plus how far through it.
    const level = p.achievementLevel != null ? Math.floor(p.achievementLevel / 100) : undefined;
    const levelPct = p.achievementLevel != null ? p.achievementLevel % 100 : undefined;
    const value = { configured: true, level, levelPct, drops: p.totalGold, xp: p.totalExperiencePoints, targetXp: p.targetExperiencePoints };
    await setJSON(CACHE_KEY, { at: Date.now(), value });
    res.status(200).json(value);
  } catch (e) {
    if (e instanceof ZwiftApiUnavailable) {
      res.status(200).json({ configured: false, error: e.message });
      return;
    }
    res.status(200).json({ configured: true, error: e instanceof Error ? e.message : "Failed" });
  }
}
