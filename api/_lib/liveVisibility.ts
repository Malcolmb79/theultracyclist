import type { VercelRequest } from "@vercel/node";
import { readJSON } from "./kvStore.js";
import { getSessionEmail } from "./session.js";

/**
 * Settings' "Show live page to visitors" toggle, applied to every endpoint
 * that can answer "where is he".
 *
 * It used to live only in api/live-tracker.ts, which meant switching the page
 * off hid the page and nothing else: /api/live.json still returned live
 * lat/lon and /api/history.json still returned the whole track, both with
 * Access-Control-Allow-Origin: *. Anyone who had loaded the page once kept a
 * working position feed after it was hidden, and the toggle said otherwise.
 *
 * A privacy control that covers one of three doors is worse than no control,
 * because it is believed. Hence one helper, used by all of them.
 */

export const LIVE_CONFIG_KEY = "LIVE_TRACKER_CONFIG";

export type LiveAccess = {
  /** Signed in - the owner previews the real page while it is hidden. */
  isOwner: boolean;
  /** The toggle itself. undefined means visible, as it always has. */
  visible: boolean;
  /** Whether this request may see position data at all. */
  allowed: boolean;
};

export async function liveAccess(req: VercelRequest): Promise<LiveAccess> {
  const isOwner = Boolean(getSessionEmail(req));

  // readJSON rather than getJSON: getJSON turns an unreachable Redis into
  // null, which would read as "no config, so visible" and serve position data
  // during exactly the outage nobody is watching. Failing closed costs
  // nothing real here - live-tracker.ts reads its gpxUrl from the same store,
  // so a Redis outage already leaves the public page with nothing to draw.
  let visible: boolean;
  try {
    const config = await readJSON<{ visible?: boolean }>(LIVE_CONFIG_KEY);
    visible = config?.visible !== false;
  } catch (error) {
    console.error("Live visibility unreadable - treating the page as hidden", error);
    visible = false;
  }

  return { isOwner, visible, allowed: isOwner || visible };
}

/**
 * Cache-Control for a public feed that now varies by session.
 *
 * The owner's response must never reach a shared cache: these are edge-cached
 * by URL, so one owner request while the page is hidden would otherwise be
 * stored and handed to every visitor after it - turning the fix into the leak
 * it was meant to close.
 */
export function liveCacheControl(isOwner: boolean, publicValue: string): string {
  return isOwner ? "private, no-store" : publicValue;
}
