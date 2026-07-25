// Static background the coach should always have - athlete profile, how to
// read Whoop's day-boundary data, and the high-level TrainingPeaks ATP
// periodization plan through the record attempt itself. Manually captured
// from the athlete's TrainingPeaks ATP export (no live TrainingPeaks API
// integration exists here) - edit this file directly if the plan changes.

export const ATHLETE_PROFILE =
  "Athlete profile: 46 years old, a competitive cyclist returning to training after a long break from the bike. " +
  "Ramp volume and intensity up gradually and conservatively rather than assuming an established base - err on " +
  "the side of caution with load increases given the return-to-training context. Sleep goal: 8+ hours nightly. " +
  "Their training week runs Monday-Sunday, not Sunday-Saturday - the weekly distance/hours figures below are " +
  "already computed on that boundary, so reason about \"this week\" the same way.";

export const DATA_SEMANTICS =
  'Data semantics: on the Sleep, Recovery & Strain dashboard, "today"\'s strain is LIVE - it keeps rising all ' +
  'day as activity accumulates and is not final until the day ends. "Today"\'s recovery and sleep scores are ' +
  "the opposite: a single fixed reading computed once, first thing in the morning, from last night's sleep - " +
  "it does not move again for the rest of the day no matter what today's strain does. So a high live strain " +
  "number today says nothing about today's recovery score; today's recovery already reflects last night, before " +
  "today's training happened. Always check today's ride/workout status (given below, or via " +
  "get_rides/get_recovery_history) before advising on today's session - never assume nothing's been done yet.";

export const SEASON_PLAN =
  "Season plan (from the athlete's TrainingPeaks Annual Training Plan): periodized toward the target event itself " +
  '- "World Record Ultra", the week of June 7-13, 2027 (the Ireland north-south unsupported record attempt). ' +
  "Phase sequence and approximate dates: Preparation (through late Aug 2026) -> Base 1 (late Aug-early Oct 2026) " +
  "-> Base 2 (early Oct-early Dec 2026) -> Base 3 (early Dec 2026-late Mar 2027) -> Build 1 (late Mar-mid Apr " +
  "2027) -> Build 2 (mid Apr-late May 2027) -> Peak (late May-early Jun 2027) -> Race week (Jun 7-13 2027) -> " +
  "Transition/recovery immediately after. Planned fitness (CTL) climbs steadily from the high-teens now to " +
  "roughly 120-130 by race week - a long, progressive multi-phase build, not a short block, so don't chase big " +
  "week-to-week jumps.";
