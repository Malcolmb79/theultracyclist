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
