import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getJSON, readJSON, setJSON } from "./_lib/kvStore.js";
import { getSessionEmail } from "./_lib/session.js";

/**
 * The photographs on the public home page.
 *
 * Same shape as site-portrait.ts - public to read, session to write, stored as
 * downscaled JPEG data URLs in KV rather than in a bucket. A separate endpoint
 * rather than more fields on that one because these are a set: the home page
 * wants them together in a single request, and the About portrait is fetched
 * on a different page entirely.
 *
 * Slots are named rather than a list. The home page places each one
 * deliberately - a wide shot behind the headline, an upright one beside the
 * story - so "which photo is this" has to survive the round trip.
 */

const KV_KEY = "SITE_PHOTOS";

export const PHOTO_SLOTS = ["hero", "story"] as const;
export type PhotoSlot = (typeof PHOTO_SLOTS)[number];

// The hero is displayed full-bleed and the story photo at roughly a third of
// the page, so they get different budgets. Both are backstops - the browser
// downscales before uploading (see resizeImage.ts) - but this record is read
// on every visit to the home page, so an un-resized phone upload getting in
// would be felt by every visitor.
const MAX_BYTES: Record<PhotoSlot, number> = {
  hero: 1_400_000,
  story: 800_000,
};

const IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp);base64,/;

type Stored = Partial<Record<PhotoSlot, { dataUrl: string; updatedAt: string }>>;

function isSlot(value: unknown): value is PhotoSlot {
  return typeof value === "string" && (PHOTO_SLOTS as readonly string[]).includes(value);
}

/** Just the URLs, which is all the page wants. */
function publicShape(stored: Stored | null): Record<PhotoSlot, string | null> {
  return {
    hero: stored?.hero?.dataUrl ?? null,
    story: stored?.story?.dataUrl ?? null,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "POST") {
    if (!getSessionEmail(req)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const body = (req.body ?? {}) as { slot?: string; dataUrl?: string | null };
    if (!isSlot(body.slot)) {
      res.status(400).json({ error: "Unknown photo slot" });
      return;
    }
    const slot = body.slot;

    if (body.dataUrl != null) {
      if (!IMAGE_DATA_URL.test(body.dataUrl)) {
        res.status(400).json({ error: "That doesn't look like an image." });
        return;
      }
      if (body.dataUrl.length > MAX_BYTES[slot]) {
        res.status(413).json({ error: "That image is too large - try a smaller one." });
        return;
      }
    }

    // readJSON, not getJSON: this is a read-modify-write over a record holding
    // the other slot too, and treating an unreachable Redis as "nothing stored"
    // would quietly delete whatever isn't in this request. Same reasoning as
    // live-tracker.ts's config save.
    let existing: Stored;
    try {
      existing = (await readJSON<Stored>(KV_KEY)) ?? {};
    } catch (error) {
      console.error("Refusing to save site photo - could not read current state", error);
      res.status(503).json({ error: "Storage is unavailable right now - nothing was saved." });
      return;
    }

    const next: Stored = { ...existing };
    // An explicit null clears one slot without touching the other, which is
    // how "remove" works.
    if (body.dataUrl == null) delete next[slot];
    else next[slot] = { dataUrl: body.dataUrl, updatedAt: new Date().toISOString() };

    await setJSON(KV_KEY, next);
    res.status(200).json({ ok: true, photos: publicShape(next) });
    return;
  }

  const stored = await getJSON<Stored | null>(KV_KEY);
  // Matches site-portrait.ts: long enough that the home page isn't reading KV
  // per visitor, short enough that swapping a photo doesn't leave the old one
  // up for the rest of the day.
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
  res.status(200).json({ photos: publicShape(stored) });
}
