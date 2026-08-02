import type { VercelRequest, VercelResponse } from "@vercel/node";
import { trackPoints } from "./_lib/trackerDb.js";

/**
 * The map track, decimated to at most 2000 points however long the ride runs.
 *
 * Cached for a minute rather than ten seconds: a completed track barely
 * changes between polls, and the map redraws the whole polyline each time it
 * arrives. This is also the expensive query of the two, so it is the one worth
 * keeping away from the database.
 */

const MAX_POINTS = 2000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requested = Number(req.query.points);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 100), MAX_POINTS) : MAX_POINTS;

  try {
    const points = await trackPoints(limit);
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60, stale-while-revalidate=120");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({
      // Flat arrays rather than objects per point: at 2000 points the object
      // form is several times the bytes for the same information, and this is
      // downloaded repeatedly by phones on mobile data for hours.
      count: points.length,
      lat: points.map((p) => Math.round(p.lat * 1e5) / 1e5),
      lon: points.map((p) => Math.round(p.lon * 1e5) / 1e5),
      ts: points.map((p) => p.ts),
      // Which source drew each segment, so the page can show where the trace
      // fell back to the phone rather than presenting one continuous line of
      // uniform confidence.
      source: points.map((p) => (p.device === "edge1040" ? "e" : "t")),
    });
  } catch (error) {
    console.error("history.json", error);
    res.setHeader("Cache-Control", "public, max-age=5");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(503).json({ count: 0, lat: [], lon: [], ts: [], source: [], error: "Track unavailable" });
  }
}
