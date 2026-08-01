import { fetchWhoopHistory } from "../whoop-data.js";
import { fetchStravaRides, type Ride } from "../strava-activities.js";
import { fetchCoachingSettings } from "../coaching-settings.js";
import { fetchGoals } from "../trends-goals.js";
import { fetchHealthHistory } from "../health-data.js";
import type { ChatContext } from "../coaching-chat.js";
import { irelandDateStr, irelandTodayDateStr, whoopDayStr } from "./timeContext.js";
import { isWeightFieldName } from "./weightField.js";

// Monday-start week boundary, matching the athlete's training-week
// convention (see ATHLETE_PROFILE in coachContext.ts) - mirrors the
// identical calc in the browser's useCoachingData.ts, duplicated here since
// this runs server-side with no browser to compute and send a snapshot
// (the WhatsApp webhook's only caller - see whatsapp-webhook.ts), matching
// how this project already keeps its api/ and src/ TypeScript projects
// decoupled rather than sharing code across that boundary.
function startOfWeek(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d.toISOString().slice(0, 10);
}

function rideDateStr(ride: Ride): string {
  return irelandDateStr(new Date(ride.startDate));
}

// Builds the same recovery/strain/sleep/weekly-progress snapshot the
// browser chat client normally computes itself (see narrativeInputFrom in
// CoachingPage.tsx) and POSTs alongside every chat/narrative request - the
// WhatsApp webhook has no browser session to do that, so it fetches the
// underlying data directly and reproduces the calc here instead.
const LB_TO_KG = 0.45359237;

/**
 * The most recent body weight, in kilograms whatever the export stored.
 *
 * Apple Health keeps body mass in the device's own unit - this athlete's is
 * pounds - and handing the coach the raw figure had it opening with "you're
 * around 159-160 lb, which is roughly 72-73 kg" to someone who reads in
 * metric. Converting here means it never has to do that in the reply.
 */
async function latestWeightKg(): Promise<number | null> {
  const history = await fetchHealthHistory(60);
  for (const date of Object.keys(history).sort().reverse()) {
    const day = history[date];
    const key = Object.keys(day).find((name) => isWeightFieldName(name));
    if (!key) continue;
    const { value, unit } = day[key];
    return Math.round((/^(lb|lbs|pound)/i.test(unit ?? "") ? value * LB_TO_KG : value) * 10) / 10;
  }
  return null;
}

export type WhoopReadings = Pick<
  ChatContext,
  "recoveryScore" | "hrvMs" | "restingHeartRate" | "strainScore" | "sleepPerformance" | "recentAvgStrain" | "recoveryDate" | "strainDate" | "sleepDate"
>;

/**
 * The latest scored value of each Whoop field, with the day it came from.
 *
 * Separate from computeChatContext because the daily note only needs this
 * much. Reaching for the whole snapshot there pulled Whoop, Strava, the health
 * history twice, goals and settings on every page load, and the request stopped
 * coming back at all - far too much work for a card that renders on open.
 */
export async function latestWhoopReadings(): Promise<WhoopReadings> {
  const whoop = await fetchWhoopHistory().catch(() => null);
  return readingsFrom(whoop?.history ?? []);
}

type WhoopHistory = NonNullable<Awaited<ReturnType<typeof fetchWhoopHistory>>>["history"];

/** `history` is newest first, the order whoop-data returns it in. */
function readingsFrom(history: WhoopHistory): WhoopReadings {
  // Each field falls back to the last day it was actually scored, and its day
  // travels with it. Whoop publishes recovery and sleep hours after the watch
  // shows them and strain climbs live all day, so the newest cycle is often
  // part-empty - and the three fields can legitimately be from three different
  // days. Withholding anything that wasn't today's was the previous guard
  // against a stale figure being read as this morning's; it backfired, because
  // a prompt with no recovery score in it got one invented. The coach is given
  // the latest of everything and told to name the day whenever it isn't
  // today's. Same per-field fallback as the rings widget (src/utils/latestWhoop.ts).
  const newestScored = <K extends "recovery" | "strain" | "sleep">(key: K) => {
    for (const day of history) {
      if (day[key]) return { value: day[key], date: whoopDayStr(new Date(day.date)) };
    }
    return null;
  };
  const recovery = newestScored("recovery");
  const strain = newestScored("strain");
  const sleep = newestScored("sleep");

  const last3Strain = history
    .slice(0, 3)
    .map((d) => d.strain?.score)
    .filter((v): v is number => v != null);

  return {
    recoveryScore: recovery?.value?.score ?? null,
    hrvMs: recovery?.value?.hrvMs ?? null,
    restingHeartRate: recovery?.value?.restingHeartRate ?? null,
    strainScore: strain?.value?.score ?? null,
    sleepPerformance: sleep?.value?.performancePercent ?? null,
    recoveryDate: recovery?.date ?? null,
    strainDate: strain?.date ?? null,
    sleepDate: sleep?.date ?? null,
    recentAvgStrain:
      last3Strain.length > 0 ? Math.round((last3Strain.reduce((a, b) => a + b, 0) / last3Strain.length) * 10) / 10 : null,
  };
}

export async function computeChatContext(): Promise<Partial<ChatContext>> {
  const [whoop, rides, settings] = await Promise.all([
    fetchWhoopHistory().catch(() => null),
    fetchStravaRides().catch(() => [] as Ride[]),
    fetchCoachingSettings().catch(() => ({})),
  ]);

  const readings = readingsFrom(whoop?.history ?? []);

  const todayStr = irelandTodayDateStr();
  const weekStart = startOfWeek(todayStr);
  const thisWeekRides = rides.filter((r) => rideDateStr(r) >= weekStart);
  const weeklyDistanceKm = Math.round(thisWeekRides.reduce((sum, r) => sum + r.distanceKm, 0) * 10) / 10;

  const todaysRides = rides.filter((r) => rideDateStr(r) === todayStr);
  const hasRiddenToday = todaysRides.length > 0;
  const todayDistanceKm = hasRiddenToday
    ? Math.round(todaysRides.reduce((sum, r) => sum + r.distanceKm, 0) * 10) / 10
    : null;

  return {
    ...readings,
    weeklyDistanceKm,
    weeklyTargetKm: settings.weeklyDistanceKm ?? null,
    phase: settings.phase ?? null,
    customRules: settings.customRules ?? null,
    hasRiddenToday,
    todayDistanceKm,
    goals: await fetchGoals(),
    // Metric unless imperial has been chosen: kg and km are the default.
    unitSystem: settings.unitSystem === "imperial" ? "imperial" : "metric",
    latestWeightKg: await latestWeightKg(),
    heightCm: settings.heightCm ?? null,
    weeklyTargetHours: settings.weeklyHours ?? null,
    ftpWatts: settings.ftpWatts ?? null,
  };
}
