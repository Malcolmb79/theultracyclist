import type { TrainingPeaksData } from "../_routes/trainingpeaks.js";
import type { CoachBaseline } from "./coachBaseline.js";
import type { GarminReadings } from "./garminReadings.js";

// Static background the coach should always have - how to read Garmin's
// readings and TrainingPeaks' figures, and the athlete's approved training
// plan (the baseline, kept in Redis - see coachBaseline.ts - because this
// repository is public and the plan holds personal health detail).

export const LANGUAGE_STYLE =
  'Write in UK English throughout - British spelling ("colour", "favourite", "organise", "prioritise", "metre") ' +
  "and phrasing, never American.";

const WEEK_CONVENTION =
  "The athlete's training week runs Monday-Sunday, not Sunday-Saturday - the weekly distance/hours figures " +
  'below are already computed on that boundary, so reason about "this week" the same way.';

/** The approved plan's rules, or a note that none is loaded yet. */
export function planContext(baseline: CoachBaseline | null): string {
  const rules = baseline
    ? baseline.rules
    : "No approved training plan has been loaded yet. Follow the workouts and Annual Training Plan in " +
      "TrainingPeaks, and ask the athlete before assuming anything about the target event.";
  return `${rules}\n\n${WEEK_CONVENTION}`;
}

/**
 * A Garmin reading with the day it came from, rendered for the prompt.
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
  return `${label}: ${value}${unit} - from ${describeDate(date, todayStr)}, NOT today's; today's has not synced from Garmin yet`;
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
  "Every number you state about Training Readiness, HRV, resting heart rate, sleep, Body Battery or training " +
  "load must appear verbatim in the readings below or in a tool result - never estimate one, never average " +
  "two, never carry a figure over from another day. " +
  "Readings in the snapshot, specifically, must appear verbatim in the " +
  "readings below - never estimate one, never average two, never carry a figure over from another day. Each " +
  "reading is labelled with the day it came from. If a reading is not today's, say so and name the day it is " +
  "from before drawing anything from it; do not present it as this morning's. If a reading has no record at " +
  "all, say it hasn't come through rather than quietly working around the gap. The athlete reads your reply " +
  "beside the widgets showing the same figures, so an unlabelled or invented number contradicts what is on the " +
  "screen next to it.";

export const DATA_SEMANTICS =
  "Data semantics - all recovery data comes from the athlete's Garmin watch. Sleep score (0-100) is fixed once, " +
  "on waking, from last night. Training Readiness (0-100; Garmin's levels are Prime 95+, High 75-94, Moderate " +
  "50-74, Low 25-49, Poor below 25) is first set on waking and then updates through the day as recovery time " +
  "counts down and stress accumulates, so it can differ from this morning's. HRV is last night's overnight " +
  "average and is best judged against its 7-day average and Garmin's HRV status (balanced, unbalanced, low, " +
  "poor), not as an absolute number. Body Battery (0-100) is LIVE: it recharges overnight and drains through " +
  "the day with activity and stress; the snapshot gives the latest synced reading and its time, which can be " +
  "an hour or so behind the watch. Training load is Garmin's per-activity load: today's figure only covers " +
  "activities synced so far and climbs as the day goes on, and the 7-day acute load is the running total " +
  "Garmin compares against the athlete's chronic load. Recovery time is how many hours Garmin still recommends " +
  "before the next hard effort. Always check today's ride/workout status (given below, or via get_rides or " +
  "get_garmin_history) before advising on today's session - never assume nothing has been done yet.";

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

/**
 * Used in place of TRAININGPEAKS_PRECEDENCE once TrainingPeaks is answering.
 *
 * "Prefer TrainingPeaks" left the coach still holding two sets of figures, and
 * it opened a reply with "computed from your Strava power data" on a question
 * that named TrainingPeaks. When TrainingPeaks has the data it is not the
 * better source, it is the only one - so the alternative is not to be quoted,
 * caveated, or mentioned at all.
 */
export const TRAININGPEAKS_SOLE_SOURCE =
  "TrainingPeaks is connected and is the SINGLE SOURCE OF TRUTH. Every figure you give for CTL, ATL, TSB, " +
  "form, training load, planned TSS or the Annual Training Plan must come from get_trainingpeaks and " +
  "nothing else. Do not compute these yourself, do not quote the dashboard's versions, and do not caveat " +
  "your answer with where it came from - the athlete knows, and a phrase like \"computed from your Strava " +
  "power data\" is simply wrong now. Never contrast the two sources or explain that they differ unless the " +
  "athlete asks about the difference directly. Individual rides are a separate matter: get_rides still " +
  "describes what a given ride did, and that is not something TrainingPeaks overrides. If a specific figure " +
  "is genuinely missing from TrainingPeaks, say it is not in TrainingPeaks rather than substituting one " +
  "from somewhere else.";

// TrainingPeaks workoutTypeValueId -> sport.
const TP_SPORTS: Record<string, string> = {
  "1": "swim", "2": "bike", "3": "run", "4": "brick", "5": "cross-training", "6": "race", "7": "day off",
  "8": "mountain bike", "9": "strength", "10": "custom", "11": "XC ski", "12": "rowing", "13": "walk", "100": "other",
};

function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const weekday = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (weekday === 0 ? 6 : weekday - 1));
  return d.toISOString().slice(0, 10);
}

/**
 * The TrainingPeaks figures the coach should have in front of it on every
 * message - today's form, this week's plan target and what is scheduled -
 * rather than only behind a tool it might not think to call.
 */
export function trainingPeaksLines(tp: TrainingPeaksData | null, todayStr: string): string[] {
  if (!tp?.configured) return ["TrainingPeaks: not connected"];
  if (tp.authExpired) return ["TrainingPeaks: connection expired - needs reconnecting in Settings"];
  const lines: string[] = [];
  const fitness = tp.fitness.filter((p) => p.date <= todayStr && p.ctl != null).at(-1);
  if (fitness) {
    lines.push(
      `TrainingPeaks fitness (${fitness.date === todayStr ? "today" : fitness.date}): CTL ${fitness.ctl}, ATL ${fitness.atl}, TSB ${fitness.tsb}`,
    );
  }
  const week = tp.atp.find((w) => w.weekStart === mondayOf(todayStr));
  if (week) {
    lines.push(
      `This week's Annual Training Plan target: ${[
        week.tssTarget != null ? `${week.tssTarget} TSS` : null,
        week.ctlTarget != null ? `CTL ${week.ctlTarget}` : null,
        week.tsbTarget != null ? `TSB ${week.tsbTarget}` : null,
      ]
        .filter(Boolean)
        .join(", ")}`,
    );
  }
  const describe = (w: TrainingPeaksData["workouts"][number]) =>
    [
      w.title,
      w.sport ? TP_SPORTS[w.sport] ?? null : null,
      w.plannedMinutes != null ? `${w.plannedMinutes} min` : null,
      w.plannedTss != null ? `${w.plannedTss} TSS planned` : null,
    ]
      .filter(Boolean)
      .join(", ");
  if (tp.workoutsUnavailable) {
    lines.push(
      "TrainingPeaks workouts could not be read just now - do not say what is or isn't planned; say the " +
        "workouts couldn't be loaded and suggest trying again shortly.",
    );
    return lines;
  }
  const today = tp.workouts.filter((w) => w.date === todayStr);
  lines.push(
    today.length > 0
      ? `Planned in TrainingPeaks today: ${today.map((w) => `${describe(w)}${w.completed ? " (completed)" : ""}`).join("; ")}`
      : "Planned in TrainingPeaks today: nothing",
  );
  const upcoming = tp.workouts.filter((w) => w.date > todayStr && !w.completed).slice(0, 4);
  if (upcoming.length > 0) lines.push(`Next in TrainingPeaks: ${upcoming.map((w) => `${w.date} ${describe(w)}`).join("; ")}`);
  const weekStart = mondayOf(todayStr);
  const doneThisWeek = tp.workouts.filter((w) => w.completed && w.date >= weekStart && w.date <= todayStr);
  if (doneThisWeek.length > 0) lines.push(`Completed in TrainingPeaks this week: ${doneThisWeek.length} workout(s)`);
  return lines;
}

/**
 * The Garmin snapshot lines, shared with the daily note. Every reading is
 * labelled with the day it came from - the coach is told to name that day
 * whenever it is not today's rather than letting a stale figure pass as this
 * morning's.
 */
export function garminSnapshotLines(r: Partial<GarminReadings>, todayStr: string): string[] {
  const lines: string[] = [];
  lines.push(readingLine("Training Readiness", r.readiness, r.readinessDate, "/100", todayStr));
  lines.push(
    readingLine(
      "Overnight HRV",
      r.hrvMs,
      r.hrvDate,
      ` ms${r.hrvWeeklyMs != null ? ` (7-day average ${r.hrvWeeklyMs} ms${r.hrvStatus ? `, status ${r.hrvStatus}` : ""})` : ""}`,
      todayStr,
    ),
  );
  lines.push(readingLine("Resting heart rate", r.restingHeartRate, r.restingHeartRateDate, " bpm", todayStr));
  lines.push(
    readingLine(
      "Sleep score",
      r.sleepScore,
      r.sleepDate,
      `/100${r.sleepHours != null ? ` from ${r.sleepHours}h asleep${r.sleepNeedHours != null ? ` (Garmin's sleep need ${r.sleepNeedHours}h)` : ""}` : ""}`,
      todayStr,
    ),
  );
  lines.push(
    r.bodyBattery == null
      ? "Body Battery: no reading on record"
      : r.bodyBatteryDate === todayStr
        ? `Body Battery: ${r.bodyBattery} as of ${r.bodyBatteryAt ?? "the latest sync"} today - LIVE, drains through the day${r.bodyBatteryAtWake != null ? `; woke at ${r.bodyBatteryAtWake}` : ""}`
        : readingLine("Body Battery", r.bodyBattery, r.bodyBatteryDate, "", todayStr),
  );
  lines.push(
    r.trainingLoadToday == null
      ? "Training load today: nothing synced from Garmin yet today"
      : `Training load so far today: ${r.trainingLoadToday} - LIVE, rises as activities sync`,
  );
  if (r.recentAvgLoad != null) lines.push(`Average daily training load, last 3 days: ${r.recentAvgLoad}`);
  if (r.acuteLoad != null) lines.push(readingLine("7-day acute training load", r.acuteLoad, r.acuteLoadDate, "", todayStr));
  if (r.recoveryTimeHours != null) {
    lines.push(readingLine("Garmin recovery time remaining", r.recoveryTimeHours, r.recoveryTimeDate, " hours", todayStr));
  }
  return lines;
}
