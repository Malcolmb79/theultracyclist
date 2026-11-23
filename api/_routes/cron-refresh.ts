import type { VercelRequest, VercelResponse } from "@vercel/node";
import { timingSafeEqual } from "node:crypto";
import { refreshStravaHistoryCache } from "./strava-activities.js";

/**
 * Keeps the slow upstreams warm on a schedule.
 *
 * Strava's activity list is slow when cold - paging 200 activities takes about
 * ten seconds. Left alone, whoever opens the dashboard first pays that cost.
 * This refreshes the dashboard's stored ride history and re-requests the
 * public ride list so the edge cache holds a fresh copy.
 *
 * Only Vercel's scheduler may run it. Vercel sends CRON_SECRET as a bearer
 * token, and without that secret configured the endpoint refuses everyone:
 * left open, anyone could make it spend Strava's rate limit and the
 * function's time on demand.
 */

function authorised(req: VercelRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.authorization ?? "";
  const expected = `Bearer ${secret}`;
  return !!secret && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!authorised(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "https";
  const origin = `${proto}://${req.headers.host}`;
  const timed = async (name: string, work: () => Promise<unknown>) => {
    const startedAt = Date.now();
    try {
      await work();
      return { name, ok: true, ms: Date.now() - startedAt };
    } catch (error) {
      console.error(`cron-refresh: ${name} failed`, error);
      return { name, ok: false, ms: Date.now() - startedAt };
    }
  };

  const results = await Promise.all([
    timed("ride history", () => refreshStravaHistoryCache()),
    timed("public rides", async () => {
      const response = await fetch(`${origin}/api/strava-activities`);
      if (!response.ok) throw new Error(String(response.status));
    }),
  ]);

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ ok: results.every((r) => r.ok), results });
}
