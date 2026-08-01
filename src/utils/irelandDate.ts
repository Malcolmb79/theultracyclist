// The record attempt (and its athlete) is based in Ireland, so "today"/"this
// week" boundaries are computed in this fixed zone rather than trusting the
// browser's own local time (correct only if the device happens to be set to
// Irish time) or UTC (wrong for roughly the first hour of every Irish day
// during BST, since Irish local midnight is 23:00 UTC the previous day).
// Mirrors api/_lib/timeContext.ts's identical server-side helpers - see
// that file for why this is duplicated rather than shared across the
// frontend/api boundary.
const TIME_ZONE = "Europe/Dublin";

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

// A Whoop cycle starts when the athlete goes to bed, so its recovery, HRV,
// RHR and sleep scores land the *next* morning - the watch shows them as
// today's. Bucketing a cycle by the calendar date it started therefore dates
// every reading a day early: the cycle beginning 23:17 on 31 July carries the
// 29% recovery read on the morning of 1 August.
//
// It also collides. A cycle starting 01:30 and the next starting 23:21 the
// same evening both land on that one date, leaving the day between them empty
// - which is why a day could go blank on Trends while two readings stacked on
// its neighbour.
//
// So an evening start belongs to the morning it runs into. Cycles are
// contiguous, so this gives one reading per day with no gaps and no stacking.
// Mirrored in api/_lib/timeContext.ts - the two must agree, or the coach and
// the widgets disagree about which day a reading belongs to.
const EVENING_HOUR = 18;

export function whoopDayStr(cycleStart: Date): string {
  const date = irelandDateStr(cycleStart);
  if (irelandHour(cycleStart) < EVENING_HOUR) return date;
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function irelandHour(date: Date): number {
  const hour = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", hourCycle: "h23" })
    .formatToParts(date)
    .find((p) => p.type === "hour")?.value;
  return Number(hour ?? "0");
}

// Minutes since local midnight in Ireland, e.g. 07:30 -> 450 - used by
// anything that needs "how far through the day is it right now" in the
// athlete's own timezone rather than the visiting device's (see
// estimateCalorieBurn.ts).
export function irelandMinutesSinceMidnight(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}
