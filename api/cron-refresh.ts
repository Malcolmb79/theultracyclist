import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Keeps the slow, cacheable upstreams warm on a schedule.
 *
 * Both of these are cached at the edge, and both are slow when cold - Whoop
 * because recovery lands each morning and strain climbs all day, Strava because
 * paging 200 activities takes about ten seconds. Left alone, whoever opens the
 * dashboard first pays that cost and sees stale figures until they do.
 *
 * Deliberately just re-requests the public URLs rather than recomputing
 * anything: that populates the very cache entry a visitor will hit, which a
 * direct in-process call would not.
 *
 * This narrows the staleness window; it does not close it. Whoop webhooks are
 * the way to be told the moment a score lands rather than finding out on the
 * next tick.
 */

const WARM_PATHS = ["/api/whoop-data", "/api/strava-activities?count=200", "/api/strava-activities"];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Vercel sends the cron secret as a bearer token when one is configured.
  // Enforced only if set: without it this endpoint does nothing but re-request
  // two already-public URLs, so it is not worth failing closed over.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "https";
  const origin = `${proto}://${req.headers.host}`;

  const results = await Promise.all(
    WARM_PATHS.map(async (path) => {
      const startedAt = Date.now();
      try {
        // Cache-busted so this actually re-fetches upstream instead of being
        // served the stale copy it is meant to be replacing, then the plain URL
        // is requested to store the fresh result under the key visitors use.
        await fetch(`${origin}${path}${path.includes("?") ? "&" : "?"}warm=${Date.now()}`);
        const res2 = await fetch(`${origin}${path}`);
        return { path, status: res2.status, ms: Date.now() - startedAt };
      } catch (error) {
        return { path, status: "error", ms: Date.now() - startedAt, message: String(error) };
      }
    }),
  );

  res.status(200).json({ ok: true, warmed: results });
}
