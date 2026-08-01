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

  const durationMinutes =
    (fields.DURATION ? parseDuration(fields.DURATION) : null) ??
    (fields.DTEND ? minutesBetween(start, fields.DTEND) : null) ??
    undefined;

  const text = `${title}\n${description ?? ""}`;
  const stated = readTss(text);
  const tss = stated ?? (durationMinutes ? estimateTssFromDuration(durationMinutes, text) : undefined);

  return {
    date,
    title: title || "Planned workout",
    description,
    durationMinutes: durationMinutes ?? undefined,
    tss: tss ?? undefined,
    tssEstimated: stated == null && tss != null ? true : undefined,
  };
}
