import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSessionEmail } from "./_lib/session.js";
import { getJSON, setJSON } from "./_lib/kvStore.js";
import { fetchCoachingSettings } from "./coaching-settings.js";
import { parseIcsEvents, type CalendarEvent } from "./_lib/icsCalendar.js";

/**
 * The athlete's TrainingPeaks calendar, read as a subscribed .ics feed.
 *
 * TrainingPeaks has no personal API - it is partner-only, and they say plainly
 * that access is not available for personal use - so the Premium calendar feed
 * is the only automatable route in. It is a real limitation, not a shortcut:
 * the feed carries 5 days back and 14 days forward, refreshes up to 24 hours
 * behind the app, and omits planned TSS entirely (see icsCalendar.ts).
 *
 * Read-only and never written into the planned-workouts store. Merging a feed
 * that TrainingPeaks rewrites on its own schedule into the athlete's own saved
 * workouts would mean a workout deleted there silently deleting one here, and
 * no way to tell which came from where. Callers merge at read time instead, so
 * pointing this at a different calendar - or removing the URL - takes effect
 * immediately and destroys nothing.
 */

const CACHE_KEY = "TRAININGPEAKS_CALENDAR_CACHE";
// The upstream refreshes at most daily, so anything shorter is polling a feed
// that cannot have changed.
const CACHE_MS = 60 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 8000;
// A calendar feed is text; anything this large is not one, and streaming an
// unbounded body into memory is how a serverless function dies.
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * The URL is athlete-supplied and fetched by the server, which is a
 * server-side request forgery primitive unless it is constrained. Restricting
 * it to TrainingPeaks' own hosts over HTTPS means it cannot be pointed at
 * internal addresses, cloud metadata endpoints, or anything else this function
 * can reach but the athlete cannot.
 */
const ALLOWED_HOSTS = [/(^|\.)trainingpeaks\.com$/i];

export function isAllowedCalendarUrl(raw: string): boolean {
  try {
    const url = new URL(raw.trim().replace(/^webcal:\/\//i, "https://"));
    if (url.protocol !== "https:") return false;
    return ALLOWED_HOSTS.some((pattern) => pattern.test(url.hostname));
  } catch {
    return false;
  }
}

/** webcal:// is what TrainingPeaks hands out; it is https underneath. */
function toHttps(raw: string): string {
  return raw.trim().replace(/^webcal:\/\//i, "https://");
}

type Cached = { fetchedAt: number; url: string; events: CalendarEvent[] };

export async function fetchTrainingPeaksEvents(force = false): Promise<{
  events: CalendarEvent[];
  configured: boolean;
  error?: string;
  fetchedAt?: number;
}> {
  const settings = (await fetchCoachingSettings()) as { trainingPeaksIcsUrl?: string };
  const url = settings.trainingPeaksIcsUrl?.trim();
  if (!url) return { events: [], configured: false };
  if (!isAllowedCalendarUrl(url)) {
    return { events: [], configured: true, error: "That doesn't look like a TrainingPeaks calendar URL." };
  }

  const cached = await getJSON<Cached>(CACHE_KEY).catch(() => null);
  const fresh = cached && cached.url === url && Date.now() - cached.fetchedAt < CACHE_MS;
  if (fresh && !force) return { events: cached.events, configured: true, fetchedAt: cached.fetchedAt };

  try {
    const response = await fetch(toHttps(url), {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      headers: { Accept: "text/calendar, text/plain" },
    });
    if (!response.ok) throw new Error(`Calendar fetch failed (${response.status})`);

    const text = await response.text();
    if (text.length > MAX_BYTES) throw new Error("Calendar feed is unexpectedly large");
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("That URL didn't return a calendar");

    const events = parseIcsEvents(text);
    const fetchedAt = Date.now();
    await setJSON(CACHE_KEY, { fetchedAt, url, events } satisfies Cached).catch(() => {});
    return { events, configured: true, fetchedAt };
  } catch (error) {
    // A stale copy beats nothing: the feed is a day behind at the best of
    // times, so yesterday's read is still a fair picture of the week ahead.
    const reason = error instanceof Error ? error.message : "Calendar fetch failed";
    if (cached && cached.url === url) {
      return { events: cached.events, configured: true, error: reason, fetchedAt: cached.fetchedAt };
    }
    return { events: [], configured: true, error: reason };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!getSessionEmail(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const result = await fetchTrainingPeaksEvents(req.query.refresh === "1");
  res.setHeader("Cache-Control", "private, max-age=300");
  res.status(200).json(result);
}
