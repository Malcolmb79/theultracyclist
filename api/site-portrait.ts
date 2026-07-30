import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getJSON, setJSON } from "./_lib/kvStore.js";
import { getSessionEmail } from "./_lib/session.js";

/**
 * The portrait shown on the public About section.
 *
 * Readable without a session on purpose - it's a photo the athlete has chosen
 * to publish on the marketing site, and the site is what renders it. Writing
 * needs a session.
 *
 * Stored as a downscaled JPEG data URL in the same KV as everything else,
 * matching progress-photos.ts: one endpoint, no bucket, no signed URLs, no
 * second place for data to live.
 */

const KV_KEY = "SITE_PORTRAIT";

// The client downscales before upload (see resizeImage.ts). This is the
// backstop against a caller that doesn't, since the whole record is read on
// every visit to the public page.
const MAX_BYTES = 600_000;

type Stored = { dataUrl: string; updatedAt: string };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "POST") {
    if (!getSessionEmail(req)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const body = req.body as { dataUrl?: string | null };

    // An explicit null clears it, which is how "remove" works - the public
    // page then falls back to the bundled placeholder.
    if (body.dataUrl == null) {
      await setJSON(KV_KEY, null);
      res.status(200).json({ ok: true, portraitDataUrl: null });
      return;
    }

    if (!/^data:image\/(jpeg|png|webp);base64,/.test(body.dataUrl)) {
      res.status(400).json({ error: "That doesn't look like an image." });
      return;
    }
    if (body.dataUrl.length > MAX_BYTES) {
      res.status(413).json({ error: "That image is too large - try a smaller one." });
      return;
    }

    await setJSON(KV_KEY, { dataUrl: body.dataUrl, updatedAt: new Date().toISOString() } satisfies Stored);
    res.status(200).json({ ok: true, portraitDataUrl: body.dataUrl });
    return;
  }

  const stored = await getJSON<Stored | null>(KV_KEY);
  // Short edge cache: the public About page hits this on every visit, and a
  // portrait changes about never - but not so long that swapping it leaves the
  // old one up for the rest of the day.
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
  res.status(200).json({ portraitDataUrl: stored?.dataUrl ?? null });
}
