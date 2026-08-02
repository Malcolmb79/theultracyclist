import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSessionEmail } from "./_lib/session.js";
import { clearSamples } from "./_lib/trackerDb.js";

/**
 * Clears every tracker sample, putting the public /live page back to blank.
 *
 * Exists because the page is built entirely from those rows, so the evening
 * before an attempt it would otherwise be showing the last training ride -
 * its distance, its clocks, its finished-ride summary - to anyone who opened
 * the link.
 *
 * Deliberately its own endpoint rather than a flag on the config POST. This
 * destroys data and nothing else here does; keeping it separate means it
 * can't be triggered as a side effect of saving a route URL, and it reads as
 * what it is in the network log afterwards.
 *
 * Authenticated the same way the layout save is - the Microsoft session
 * cookie, i.e. Malcolm only. The GET side of the tracker is public; this is
 * emphatically not.
 *
 * Irreversible. There is no soft delete and no undo: the confirmation lives
 * in the UI (see SettingsPage), because a server that asks "are you sure?"
 * over HTTP has only moved the problem.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!getSessionEmail(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const deleted = await clearSamples();
    res.status(200).json({ ok: true, deleted });
  } catch (error) {
    console.error("tracker-reset", error);
    res.status(503).json({ error: "Storage unavailable - nothing was cleared." });
  }
}
