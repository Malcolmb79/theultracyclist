/**
 * Just enough iCalendar to read a TrainingPeaks workout feed.
 *
 * A parser rather than a library because the feed is a handful of VEVENTs with
 * four fields that matter, and pulling in a full RFC 5545 implementation to
 * read DTSTART and SUMMARY would be more surface than the whole feature.
 *
 * What TrainingPeaks actually publishes is narrower than it looks: workouts
 * and events only, 5 days back and 14 days forward, refreshed up to 24 hours
 * behind the app - and, critically, WITHOUT planned TSS. Their calendar export
 * carries no training-load figure at all, which is the one number a CTL/ATL
 * projection needs. So TSS is read from the title or description when it is
 * written there ("TSS 85", the convention intervals.icu users already follow),
 * and estimated from planned duration otherwise.
 */

export type CalendarEvent = {
  /** Irish calendar date, YYYY-MM-DD. */
  date: string;
  title: string;
  description?: string;
  durationMinutes?: number;
  /** From the text if stated, otherwise estimated from duration. */
  tss?: number;
  /** True when tss was derived from duration rather than read from the feed. */
  tssEstimated?: boolean;
  /** True when even the session length was assumed - see ASSUMED_SESSION_MINUTES. */
  durationAssumed?: boolean;
};

/**
 * Long property values are wrapped onto continuation lines beginning with a
 * space or tab. Unfolding has to happen before anything is parsed, or a
 * description that wrapped mid-word silently loses the remainder.
 */
function unfold(ics: string): string[] {
  const out: string[] = [];
  for (const raw of ics.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += raw.slice(1);
    } else {
      out.push(raw);
    }
  }
  return out;
}

/** `\,` `\;` `\n` and `\\` are escaped in TEXT values. */
function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function splitProperty(line: string): { name: string; params: string; value: string } | null {
  // The value starts at the first unquoted colon; parameters may contain
  // quoted colons (TZID="Europe/Dublin"), so a naive indexOf(":") is wrong.
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ":" && !inQuotes) {
      const head = line.slice(0, i);
      const semi = head.indexOf(";");
      return {
        name: (semi === -1 ? head : head.slice(0, semi)).toUpperCase(),
        params: semi === -1 ? "" : head.slice(semi + 1),
        value: line.slice(i + 1),
      };
    }
  }
  return null;
}

/**
 * DTSTART comes as a date (20260803), a floating local datetime
 * (20260803T060000), or UTC (20260803T060000Z). Only the calendar day is
 * wanted, and for the UTC form that day has to be resolved in Irish local
 * time - a 23:30Z start during BST belongs to the next day, the same
 * boundary every other date in this project is bucketed on.
 */
function parseDate(value: string, timeZone: string): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s, utc] = match;
  if (!utc) return `${y}-${mo}-${d}`;

  const instant = new Date(Date.UTC(+y, +mo - 1, +d, +(h ?? 0), +(mi ?? 0), +(s ?? 0)));
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** ISO 8601 duration, e.g. PT1H30M. */
function parseDuration(value: string): number | null {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!match) return null;
  const [, days, hours, minutes, seconds] = match;
  const total = (+(days ?? 0) * 24 * 60) + (+(hours ?? 0) * 60) + +(minutes ?? 0) + +(seconds ?? 0) / 60;
  return total > 0 ? Math.round(total) : null;
}

function minutesBetween(startValue: string, endValue: string): number | null {
  const toInstant = (v: string) => {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/.exec(v.trim());
    if (!m) return null;
    const [, y, mo, d, h, mi, s] = m;
    return Date.UTC(+y, +mo - 1, +d, +(h ?? 0), +(mi ?? 0), +(s ?? 0));
  };
  const start = toInstant(startValue);
  const end = toInstant(endValue);
  if (start == null || end == null || end <= start) return null;
  return Math.round((end - start) / 60000);
}

/**
 * "TSS 85", "TSS: 85", "85 TSS" - whichever way the athlete writes it into the
 * workout title or description, since TrainingPeaks will not put it there
 * itself.
 */
function readTss(text: string): number | null {
  const labelled = /TSS[:\s]*(\d+(?:\.\d+)?)/i.exec(text) ?? /(\d+(?:\.\d+)?)\s*TSS/i.exec(text);
  if (!labelled) return null;
  const value = Number(labelled[1]);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

/**
 * Planned TSS from duration and whatever the session is called.
 *
 * TSS is duration in hours times intensity factor squared, times 100. The feed
 * gives no intensity, but a TrainingPeaks workout title almost always names
 * the type ("Bike: Endurance Ride", "Threshold 3x12"), and that is a far
 * better guide than one flat assumption: at a single IF of 0.70 a two-hour
 * endurance ride came out at 98 TSS, which is threshold work, not zone 2.
 *
 * Erring low is deliberate where it is a guess. Over-estimating planned load
 * inflates projected fitness, and an athlete who trusts an inflated CTL trains
 * through fatigue they did not know they had. Anything written in the text
 * ("TSS 85") always wins over all of this.
 */
const INTENSITY_BY_KEYWORD: { pattern: RegExp; factor: number }[] = [
  { pattern: /recovery|easy spin|shake ?out|regen/i, factor: 0.55 },
  { pattern: /vo2|anaerobic|sprint|neuromuscular/i, factor: 0.95 },
  { pattern: /threshold|ftp|race pace|time trial|\bTT\b/i, factor: 0.9 },
  { pattern: /tempo|sweet ?spot|sst/i, factor: 0.8 },
  { pattern: /endurance|base|long|aerobic|zone ?2|z2/i, factor: 0.65 },
];
// Unlabelled sessions get a middling aerobic figure rather than the highest
// one on the list.
const DEFAULT_INTENSITY_FACTOR = 0.68;

export function intensityFactorFor(text: string): number {
  return INTENSITY_BY_KEYWORD.find((entry) => entry.pattern.test(text))?.factor ?? DEFAULT_INTENSITY_FACTOR;
}

export function estimateTssFromDuration(durationMinutes: number, text = ""): number {
  const factor = intensityFactorFor(text);
  return Math.round((durationMinutes / 60) * factor ** 2 * 100);
}

/**
 * Session length out of the workout title.
 *
 * TrainingPeaks writes most planned sessions as all-day events, so the only
 * length in the feed is the one the athlete put in the name -
 * "Z2 Endurance 90min", "Easy Spin 45min", "Long Ride 3h".
 *
 * Interval notation is explicitly not a duration. "Sweet Spot 2x12min"
 * describes twelve-minute efforts, not a twelve-minute ride, and reading it as
 * one would have put a 27-TSS number on a session worth three times that.
 */
const INTERVAL_NOTATION = /\d+\s*[x×]\s*$/i;

export function durationFromTitle(title: string): number | null {
  // "3h", "2h30", "1.5h", "2 hours". The negative lookahead stops the bare "h"
  // swallowing the start of an ordinary word - without it "30 hard efforts"
  // parses as thirty hours.
  const hours = /(\d+(?:[.,]\d+)?)\s*(?:hours?|hrs?|h)(?![a-z])\s*(\d{1,2})?/i.exec(title);
  if (hours) {
    const value = Number(hours[1].replace(",", "."));
    const extra = hours[2] ? Number(hours[2]) : 0;
    if (Number.isFinite(value) && value > 0) return Math.round(value * 60 + extra);
  }

  // Every "NN min" in the title, skipping any that follows an "NxN".
  const pattern = /(\d+)\s*(?:min|mins|minutes)\b/gi;
  for (let match = pattern.exec(title); match; match = pattern.exec(title)) {
    const before = title.slice(0, match.index);
    if (INTERVAL_NOTATION.test(before)) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

/**
 * What a planned session is worth when nothing states its length.
 *
 * Interval workouts named only by their efforts ("Sweet Spot 2x12min") leave
 * no total to read. Contributing nothing would under-project fitness on
 * precisely the days that build it, so they are treated as an hour - long
 * enough to be real, short enough that being wrong costs little.
 */
const ASSUMED_SESSION_MINUTES = 60;

export function parseIcsEvents(ics: string, timeZone = "Europe/Dublin"): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  let current: Record<string, string> | null = null;

  for (const line of unfold(ics)) {
    const trimmed = line.trim();
    if (trimmed === "BEGIN:VEVENT") {
      current = {};
      continue;
    }
    if (trimmed === "END:VEVENT") {
      if (current) {
        const event = toEvent(current, timeZone);
        if (event) events.push(event);
      }
      current = null;
      continue;
    }
    if (!current) continue;

    const property = splitProperty(line);
    if (!property) continue;
    // Keep the raw params alongside the value - DTSTART needs VALUE=DATE.
    current[property.name] = property.value;
    if (property.params) current[`${property.name}__PARAMS`] = property.params;
  }

  return events.sort((a, b) => a.date.localeCompare(b.date));
}

function toEvent(fields: Record<string, string>, timeZone: string): CalendarEvent | null {
  const start = fields.DTSTART;
  if (!start) return null;
  const date = parseDate(start, timeZone);
  if (!date) return null;

  const title = unescapeText(fields.SUMMARY ?? "").trim();
  const description = fields.DESCRIPTION ? unescapeText(fields.DESCRIPTION).trim() : undefined;

  // TrainingPeaks writes most planned workouts as all-day events, whose DTEND
  // is the *next* date - an exclusive end, meaning "occupies this day", not a
  // 24-hour session. Measuring between them put 1440 minutes and 1014 TSS on a
  // 90-minute endurance ride. For those the only length available is whatever
  // the athlete wrote in the title.
  const allDay = /VALUE=DATE(?!-TIME)/i.test(fields.DTSTART__PARAMS ?? "") || /^\d{8}$/.test(start.trim());
  const scheduled = allDay
    ? null
    : (fields.DURATION ? parseDuration(fields.DURATION) : null) ??
      (fields.DTEND ? minutesBetween(start, fields.DTEND) : null);

  const durationMinutes = scheduled ?? durationFromTitle(title) ?? undefined;

  // Intensity is read from the title alone. The description is free text and
  // routinely mentions recovery in passing ("ride the recovery valleys
  // easy"), which was enough to price a Sweet Spot session as a rest day.
  const stated = readTss(`${title}\n${description ?? ""}`);
  const tss =
    stated ??
    estimateTssFromDuration(durationMinutes ?? ASSUMED_SESSION_MINUTES, title);

  return {
    date,
    title: title || "Planned workout",
    description,
    durationMinutes,
    tss,
    tssEstimated: stated == null ? true : undefined,
    /** True when even the length was assumed, not read. */
    durationAssumed: durationMinutes == null ? true : undefined,
  };
}
