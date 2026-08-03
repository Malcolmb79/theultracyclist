import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getJSON, setJSON } from "./_lib/kvStore.js";
import { getSessionEmail } from "./_lib/session.js";

/**
 * Progress photos: the standard three angles, taken on a date, kept so two
 * dates can be put side by side.
 *
 * Stored as downscaled JPEG data URLs in the same KV the rest of this app
 * uses, rather than in file storage. That is a deliberate limit rather than an
 * oversight: it keeps the feature to one endpoint with no bucket, no signed
 * URLs and no second place for data to live, at the cost of a cap on how many
 * sessions can be kept. The client downscales before upload, so a session is
 * a few hundred KB rather than the several MB a phone camera produces.
 */

export type PhotoAngle = "front" | "side" | "back";

/**
 * How a photo is framed inside the comparison window: a zoom and an offset,
 * applied when it's displayed.
 *
 * Photos taken weeks apart are never shot from quite the same spot, and in a
 * wipe comparison that reads as the subject jumping rather than as the camera
 * having moved. Storing the correction per photo, rather than per comparison,
 * means it's done once and then holds for every pairing that photo ever
 * appears in.
 *
 * The image itself is never modified - this is presentation only, so a badly
 * set alignment costs nothing and the original is always recoverable.
 */
export type PhotoFit = {
  /** Zoom, 1 = untouched. */
  s: number;
  /** Offset as a percentage of the frame, -50 to 50. */
  x: number;
  y: number;
};

export type PhotoSession = {
  /** ISO date the photos were taken. One session per date. */
  date: string;
  front?: string;
  side?: string;
  back?: string;
  frontFit?: PhotoFit;
  sideFit?: PhotoFit;
  backFit?: PhotoFit;
  /** Weight at the time, if known when the session was saved. */
  weightKg?: number;
};

const KV_KEY = "PROGRESS_PHOTOS";

// Enough to see a year of monthly photos against each other while keeping the
// stored blob to a size KV handles comfortably.
const MAX_SESSIONS = 24;

/**
 * Trims to the cap without ever dropping the first session.
 *
 * The baseline is the one photograph the others are worth comparing against,
 * and it is the first to go under a plain "keep the most recent" rule —
 * quietly, at the moment the record finally gets long enough to be
 * interesting. Everything after it is a step along the way and can be
 * thinned; where you started cannot be retaken.
 */
function trimKeepingBaseline(sessions: PhotoSession[]): PhotoSession[] {
  if (sessions.length <= MAX_SESSIONS) return sessions;
  const [baseline, ...rest] = sessions;
  return [baseline, ...rest.slice(-(MAX_SESSIONS - 1))];
}

// A downscaled session should be well under this; the check is here to reject
// an un-resized upload rather than to size the feature.
const MAX_IMAGE_CHARS = 900_000;

const IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

// Clamped rather than rejected: these come from a slider and a drag, so an
// out-of-range value is a UI bug or a stale client, not an attack, and
// silently pinning it to something sane beats refusing the whole session.
function validFit(input: unknown): PhotoFit | null {
  if (!input || typeof input !== "object") return null;
  const f = input as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
  return { s: num(f.s, 0.5, 4, 1), x: num(f.x, -50, 50, 0), y: num(f.y, -50, 50, 0) };
}

function validSession(input: unknown): PhotoSession | null {
  if (!input || typeof input !== "object") return null;
  const body = input as Record<string, unknown>;
  if (typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) return null;

  const session: PhotoSession = { date: body.date };
  for (const angle of ["front", "side", "back"] as const) {
    const value = body[angle];
    if (value == null) continue;
    // Anything that isn't an image data URL is refused outright: these are
    // written straight into an <img src> when they come back.
    if (typeof value !== "string" || !IMAGE_DATA_URL.test(value) || value.length > MAX_IMAGE_CHARS) return null;
    session[angle] = value;
  }
  for (const angle of ["front", "side", "back"] as const) {
    const fit = validFit(body[`${angle}Fit`]);
    if (fit) session[`${angle}Fit`] = fit;
  }
  if (typeof body.weightKg === "number" && Number.isFinite(body.weightKg)) session.weightKg = body.weightKg;

  // A session with no photographs is not a session - except an
  // alignment-only update, which carries no images because it is adjusting
  // ones already stored. The handler checks that date actually exists.
  const hasPhoto = session.front || session.side || session.back;
  const hasFit = session.frontFit || session.sideFit || session.backFit;
  return hasPhoto || hasFit ? session : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!getSessionEmail(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const stored = (await getJSON<PhotoSession[]>(KV_KEY)) ?? [];

  if (req.method === "POST") {
    const session = validSession(req.body);
    if (!session) {
      res.status(400).json({ error: "A session needs a date and at least one image." });
      return;
    }

    // One session per date: re-uploading a day replaces it, so a retaken
    // photo doesn't leave the original behind under the same heading.
    const existing = stored.find((s) => s.date === session.date);
    // An alignment-only update has nothing to create a session from, so it
    // must be adjusting one that exists.
    if (!session.front && !session.side && !session.back && !existing) {
      res.status(400).json({ error: "No session on that date to align." });
      return;
    }
    const merged = existing ? { ...existing, ...session } : session;
    const next = trimKeepingBaseline(
      [...stored.filter((s) => s.date !== session.date), merged].sort((a, b) => a.date.localeCompare(b.date))
    );

    await setJSON(KV_KEY, next);
    res.status(200).json({ sessions: next });
    return;
  }

  if (req.method === "DELETE") {
    const date = typeof req.query.date === "string" ? req.query.date : null;
    if (!date) {
      res.status(400).json({ error: "date is required" });
      return;
    }
    const next = stored.filter((s) => s.date !== date);
    await setJSON(KV_KEY, next);
    res.status(200).json({ sessions: next });
    return;
  }

  res.status(200).json({ sessions: stored });
}
