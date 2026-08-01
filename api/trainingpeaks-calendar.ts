import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSessionEmail } from "./_lib/session.js";
import { getJSON, setJSON } from "./_lib/kvStore.js";
import { fetchCoachingSettings } from "./coaching-settings.js";
import { parseIcsEvents, type CalendarEvent } from "./_lib/icsCalendar.js";
import { fetchStravaRides, type Ride } from "./strava-activities.js";
import { computeTss } from "./_lib/tss.js";
import { irelandDateStr, irelandTodayDateStr } from "./_lib/timeContext.js";

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

export type ReconcileRow = {
  date: string;
  /** What TrainingPeaks has on the calendar for that day, if anything. */
  planned: { title: string; tss: number | null; estimated: boolean } | null;
  /** What this app recorded from Strava for that day. */
  recorded: { rides: number; tss: number | null; noPower: boolean } | null;
  verdict: "match" | "missing-here" | "extra-here" | "no-power" | "none";
};

/**
 * Why this app's CTL disagrees with the one in TrainingPeaks.
 *
 * TrainingPeaks had the athlete at CTL 20 on a day this app said 12. Both are
 * 42-day averages of daily TSS, so a gap that size means the two are averaging
 * different days - and there are only a few ways that happens: a session
 * logged in TrainingPeaks that never reached Strava, a ride recorded without
 * power (no power, no TSS, so it contributes nothing here), or a different
 * FTP behind the arithmetic.
 *
 * This names which, per day, instead of leaving it to guesswork. It is a
 * comparison, not a correction: nothing here changes a stored figure.
 */
async function reconcile(events: CalendarEvent[]): Promise<ReconcileRow[]> {
  const [rides, settings] = await Promise.all([
    fetchStravaRides(60).catch(() => [] as Ride[]),
    fetchCoachingSettings().catch(() => ({}) as { ftpWatts?: number }),
  ]);
  const ftp = (settings as { ftpWatts?: number }).ftpWatts;

  const byDay = new Map<string, { rides: number; tss: number; noPower: boolean }>();
  for (const ride of rides) {
    const date = irelandDateStr(new Date(ride.startDate));
    const tss = computeTss(ride.weightedAvgWatts ?? ride.avgWatts, ride.movingTimeMinutes, ftp);
    const entry = byDay.get(date) ?? { rides: 0, tss: 0, noPower: false };
    entry.rides += 1;
    if (tss == null) entry.noPower = true;
    else entry.tss += tss;
    byDay.set(date, entry);
  }

  const today = irelandTodayDateStr();
  // The feed only reaches five days back, so that is the whole comparable
  // window - claiming more would be inventing agreement for days neither side
  // can speak about.
  const days = [...new Set([...events.map((e) => e.date), ...byDay.keys()])]
    .filter((d) => d <= today && d >= addDays(today, -RECONCILE_DAYS))
    .sort();

  return days.map((date) => {
    const event = events.find((e) => e.date === date) ?? null;
    const actual = byDay.get(date) ?? null;
    const planned = event ? { title: event.title, tss: event.tss ?? null, estimated: !!event.tssEstimated } : null;
    const recorded = actual
      ? { rides: actual.rides, tss: actual.noPower && actual.tss === 0 ? null : Math.round(actual.tss), noPower: actual.noPower }
      : null;

    const verdict: ReconcileRow["verdict"] =
      planned && !recorded
        ? "missing-here"
        : !planned && recorded
          ? "extra-here"
          : recorded?.noPower
            ? "no-power"
            : planned && recorded
              ? "match"
              : "none";

    return { date, planned, recorded, verdict };
  });
}

// Matches the feed's own five-day history window.
const RECONCILE_DAYS = 5;

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!getSessionEmail(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const result = await fetchTrainingPeaksEvents(req.query.refresh === "1");
  const rows = req.query.reconcile === "1" ? await reconcile(result.events).catch(() => []) : undefined;
  res.setHeader("Cache-Control", "private, max-age=300");
  res.status(200).json(rows ? { ...result, reconcile: rows } : result);
}
