// Static background the coach should always have - athlete profile, how to
// read Whoop's day-boundary data, and the high-level TrainingPeaks ATP
// periodization plan through the record attempt itself. Manually captured
// from the athlete's TrainingPeaks ATP export (no live TrainingPeaks API
// integration exists here) - edit this file directly if the plan changes.

export const LANGUAGE_STYLE =
  'Write in UK English throughout - British spelling ("colour", "favourite", "organise", "prioritise", "metre") ' +
  "and phrasing, never American.";

export const ATHLETE_PROFILE =
  "Athlete profile: 46 years old, a competitive cyclist returning to training after a long break from the bike. " +
  "Ramp volume and intensity up gradually and conservatively rather than assuming an established base - err on " +
  "the side of caution with load increases given the return-to-training context. Sleep goal: 8+ hours nightly. " +
  "Their training week runs Monday-Sunday, not Sunday-Saturday - the weekly distance/hours figures below are " +
  "already computed on that boundary, so reason about \"this week\" the same way.";

/**
 * A Whoop reading with the day it came from, rendered for the prompt.
 *
 * Withholding a reading that wasn't today's used to be the safeguard against
 * the coach citing yesterday's number as this morning's - but a prompt that
 * named no recovery score while still asking for specific numbers just got one
 * invented: "your recovery score came in at 67 this morning" beside a
 * dashboard reading 29%. Handing over the latest reading *and* its date gives
 * it something true to say either way, and nothing to fill in.
 */
export function readingLine(
  label: string,
  value: number | null | undefined,
  date: string | null | undefined,
  unit: string,
  todayStr: string,
): string {
  if (value == null) return `${label}: no reading on record`;
  if (!date) return `${label}: ${value}${unit} (day unknown - do not call it today's)`;
  if (date === todayStr) return `${label}: ${value}${unit} - today's reading`;
  return `${label}: ${value}${unit} - from ${describeDate(date, todayStr)}, NOT today's; today's has not arrived from Whoop yet`;
}

function describeDate(date: string, todayStr: string): string {
  const days = Math.round((Date.parse(`${todayStr}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
  const long = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${date}T12:00:00Z`));
  if (days === 1) return `yesterday, ${long}`;
  if (days > 1) return `${days} days ago, ${long}`;
  return long;
}

/**
 * Told to the coach alongside those readings. Without it the model has the
 * date but no instruction to pass it on, and speaks about a three-day-old
 * sleep score as if it were last night's.
 */
export const READING_HONESTY =
  "Every number you state about recovery, HRV, resting heart rate, sleep or strain must appear verbatim in the " +
  "readings below - never estimate one, never average two, never carry a figure over from another day. Each " +
  "reading is labelled with the day it came from. If a reading is not today's, say so and name the day it is " +
  "from before drawing anything from it; do not present it as this morning's. If a reading has no record at " +
  "all, say it hasn't come through rather than quietly working around the gap. The athlete reads your reply " +
  "beside the widgets showing the same figures, so an unlabelled or invented number contradicts what is on the " +
  "screen next to it.";

export const DATA_SEMANTICS =
  'Data semantics: on the Sleep, Recovery & Strain dashboard, "today"\'s strain is LIVE - it keeps rising all ' +
  'day as activity accumulates and is not final until the day ends. "Today"\'s recovery and sleep scores are ' +
  "the opposite: a single fixed reading computed once, first thing in the morning, from last night's sleep - " +
  "it does not move again for the rest of the day no matter what today's strain does. So a high live strain " +
  "number today says nothing about today's recovery score; today's recovery already reflects last night, before " +
  "today's training happened. Always check today's ride/workout status (given below, or via " +
  "get_rides/get_recovery_history) before advising on today's session - never assume nothing's been done yet.";

/**
 * TrainingPeaks outranks everything derived.
 *
 * The app computes CTL/ATL/TSB from Strava rides that recorded power, which is
 * a genuine subset of the athlete's training - it read 12 on a day
 * TrainingPeaks read 20. Both numbers are now available to the coach, and
 * without being told which wins it will quote whichever it happened to fetch,
 * or worse, average them.
 */
export const TRAININGPEAKS_PRECEDENCE =
  "TrainingPeaks is the source of truth for training load, fitness and the plan. Call get_trainingpeaks " +
  "before get_fitness for anything about CTL, ATL, TSB, form, the Annual Training Plan, or what is " +
  "scheduled, and quote its figures when the two disagree - the app's own CTL is built only from Strava " +
  "rides that recorded power, so it under-reads whenever the athlete trained without a power meter or " +
  "logged a session TrainingPeaks saw and Strava did not. The same goes for planned TSS: a figure from " +
  "TrainingPeaks is the real prescription, while one derived from a workout's title and length is an " +
  "estimate. Never average the two or present a derived number as though it came from TrainingPeaks. If " +
  "TrainingPeaks is not connected or its connection has expired, say which source you are using.";

export const SEASON_PLAN =
  "Season plan (from the athlete's TrainingPeaks Annual Training Plan): periodised toward the target event itself " +
  '- "World Record Ultra", the week of June 7-13, 2027 (the Ireland north-south unsupported record attempt). ' +
  "Phase sequence and approximate dates: Preparation (through late Aug 2026) -> Base 1 (late Aug-early Oct 2026) " +
  "-> Base 2 (early Oct-early Dec 2026) -> Base 3 (early Dec 2026-late Mar 2027) -> Build 1 (late Mar-mid Apr " +
  "2027) -> Build 2 (mid Apr-late May 2027) -> Peak (late May-early Jun 2027) -> Race week (Jun 7-13 2027) -> " +
  "Transition/recovery immediately after. Planned fitness (CTL) climbs steadily from the high-teens now to " +
  "roughly 120-130 by race week - a long, progressive multi-phase build, not a short block, so don't chase big " +
  "week-to-week jumps.";
