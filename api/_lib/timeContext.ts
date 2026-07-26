// The record attempt (and its athlete) is based in Ireland, so local time
// context for the coach is computed in this fixed zone rather than trusting
// a client clock or guessing from server UTC time - the reason the AI coach
// used to default to a generic "good morning" regardless of actual time.
const TIME_ZONE = "Europe/Dublin";

function timeOfDayLabel(hour: number): string {
  if (hour < 5) return "late night";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 21) return "evening";
  return "night";
}

// Monday-first, matching the athlete's training-week convention (see
// ATHLETE_PROFILE in coachContext.ts) - index 0 = Monday.
const WEEKDAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function daysLeftPhrase(weekdayNum: number): string {
  const daysAfterToday = 7 - weekdayNum;
  if (daysAfterToday === 0) return "today is the last day of this training week";
  if (daysAfterToday === 1) return "only Sunday is left after today";
  return `${daysAfterToday} days are left after today, through Sunday`;
}

// Ireland-local calendar date (YYYY-MM-DD) for a given instant - used
// wherever server-side code needs to bucket a UTC timestamp (a Strava ride,
// "now") into the athlete's own day/week boundaries rather than the UTC
// date, which can be off by an hour near midnight. formatToParts is used
// instead of slicing an ISO string since the input Date's own UTC offset
// says nothing about Ireland's.
export function irelandDateStr(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value ?? "1970";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

export function irelandTodayDateStr(): string {
  return irelandDateStr(new Date());
}

// Monday-start week boundary, matching the athlete's training-week
// convention (see ATHLETE_PROFILE in coachContext.ts) - same calc as
// api/_lib/coachSnapshot.ts's local copy, duplicated rather than imported
// since that file already imports FROM this one (avoids a circular need)
// and this project keeps small date helpers local to each file that needs
// them.
function startOfWeek(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function formatLongDate(dateStr: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, day: "numeric", month: "long", year: "numeric" }).format(
    new Date(`${dateStr}T12:00:00Z`),
  );
}

export function irelandTimeContext(): string {
  const parts = new Intl.DateTimeFormat("en-IE", {
    timeZone: TIME_ZONE,
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "12");
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  // 1 = Monday .. 7 = Sunday. Computed here rather than left for the model
  // to infer from the weekday name - it was getting this wrong (e.g.
  // calling Saturday "early in the week").
  const weekdayNum = WEEKDAY_ORDER.indexOf(weekday) + 1 || 1;

  const todayStr = irelandTodayDateStr();
  const thisWeekStart = startOfWeek(todayStr);
  const thisWeekEnd = addDays(thisWeekStart, 6);
  const lastWeekStart = addDays(thisWeekStart, -7);
  const lastWeekEnd = addDays(thisWeekStart, -1);

  return (
    `Today's date is ${formatLongDate(todayStr)} (${weekday}), ${String(hour).padStart(2, "0")}:${minute} in ` +
    `Ireland (${timeOfDayLabel(hour)}). Greet and phase your note for the actual time of day above - don't ` +
    "default to \"good morning\" unless it genuinely is morning there. This is day " +
    `${weekdayNum} of 7 in the current Monday-Sunday training week - ${daysLeftPhrase(weekdayNum)}. This week ` +
    `runs ${formatLongDate(thisWeekStart)} to ${formatLongDate(thisWeekEnd)}; last week was ` +
    `${formatLongDate(lastWeekStart)} to ${formatLongDate(lastWeekEnd)}. Always use these exact dates for any ` +
    "\"this week\"/\"last week\" question or tool call date range - never guess or compute a date range " +
    "yourself, and never state a ride, workout, or metric happened on a date without it actually being " +
    "present at that date in the tool data you fetched."
  );
}
