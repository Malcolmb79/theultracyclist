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

  return (
    `It's currently ${weekday} ${String(hour).padStart(2, "0")}:${minute} in Ireland (${timeOfDayLabel(hour)}). ` +
    "Greet and phase your note for the actual time of day above - don't default to \"good morning\" unless it " +
    `genuinely is morning there. This is day ${weekdayNum} of 7 in the current Monday-Sunday training week - ` +
    `${daysLeftPhrase(weekdayNum)}.`
  );
}
