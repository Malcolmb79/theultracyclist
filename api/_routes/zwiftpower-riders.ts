import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyRaceCors, getRaceAuthEmail } from "../_lib/raceToken.js";
import { getSessionEmail } from "../_lib/session.js";
import { rawSample, riderHistory, ZwiftPowerUnavailable, type RiderHistory } from "../_lib/zwiftPower.js";

/**
 * Riders' recent racing from ZwiftPower, for the Race console's commentator
 * and coach: GET ?ids=1,2,3 answers { riders: { [id]: history or null } }.
 * A handful of riders a call, one after another, so ZwiftPower sees a
 * person's worth of page loads rather than a burst; the console asks again
 * for the rest. Each rider is cached for hours (see _lib/zwiftPower).
 *
 * ?debug=1&ids=<one id>, signed in on the site, shows the login steps and
 * the raw shape of what came back - for when ZwiftPower changes something.
 */

const MAX_PER_CALL = 6;
const GAP_MS = 400;

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
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  res.setHeader("Cache-Control", "no-store");

  const ids = String(req.query.ids ?? "")
    .split(",")
    .map((x) => Number.parseInt(x, 10))
    .filter((x) => Number.isFinite(x) && x > 0)
    .slice(0, MAX_PER_CALL);

  if (req.query.debug && getSessionEmail(req)) {
    const steps: string[] = [];
    try {
      const sample = ids[0] ? await rawSample(ids[0], steps) : null;
      res.status(200).json({ ok: true, steps, sample });
    } catch (e) {
      res.status(200).json({ ok: false, error: e instanceof Error ? e.message : String(e), steps });
    }
    return;
  }

  const riders: Record<string, RiderHistory | null> = {};
  try {
    for (const [i, id] of ids.entries()) {
      if (i) await new Promise((r) => setTimeout(r, GAP_MS));
      riders[id] = await riderHistory(id);
    }
    res.status(200).json({ configured: true, riders });
  } catch (e) {
    if (e instanceof ZwiftPowerUnavailable) {
      res.status(200).json({ configured: false, error: e.message, riders });
      return;
    }
    console.error("zwiftpower-riders", e);
    res.status(502).json({ error: e instanceof Error ? e.message : "ZwiftPower lookup failed", riders });
  }
}
