import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyRaceCors, getRaceAuthEmail } from "../_lib/raceToken.js";
import { computeChatContext } from "../_lib/coachSnapshot.js";
import { computeFitnessSeries } from "../_lib/fitness.js";
import { computeTss } from "../_lib/tss.js";
import { irelandDateStr, irelandTodayDateStr } from "../_lib/timeContext.js";
import { fetchStravaRides, type Ride } from "./strava-activities.js";
import { fetchCoachingSettings } from "./coaching-settings.js";
import { fetchTrainingPeaksData } from "./trainingpeaks.js";

/**
 * The athlete's own fitness going into a race, for the Race console's coach
 * and commentator: fitness, fatigue and form (CTL, ATL, TSB), how ready
 * Garmin says they are today, what they've already ridden today, and the
 * last two weeks: how much they've ridden against the fortnight before,
 * the races in it, and which way fitness and fatigue have moved.
 *
 * The same sources the coaching chat uses, with the same precedence:
 * TrainingPeaks' own CTL/ATL/TSB when it's connected, otherwise worked out
 * from Strava rides and the FTP in the coaching settings. Fetched once when
 * the console opens and every half hour after, so a slow source costs a
 * moment at the start rather than a line mid-race.
 *
 * Gated like the other race routes: the session cookie on the site, or a
 * race key from the Sauce mod.
 */

type Fitness = { ctl: number | null; atl: number | null; tsb: number | null; source: "trainingpeaks" | "strava" };

type FitnessPoint = { date: string; ctl: number | null; atl: number | null; tsb: number | null };

/** Today's fitness, and the series it came from (for how it's moved). */
async function currentFitness(rides: Ride[] | null): Promise<(Fitness & { series: FitnessPoint[] }) | null> {
  const tp = await fetchTrainingPeaksData().catch(() => null);
  const tpSeries = tp?.fitness?.filter((p) => p.ctl != null) ?? [];
  const latestTp = tpSeries.at(-1);
  if (latestTp) return { ctl: latestTp.ctl, atl: latestTp.atl, tsb: latestTp.tsb, source: "trainingpeaks", series: tpSeries };

  if (!rides) return null;
  const settings = await fetchCoachingSettings();
  const daily = new Map<string, number>();
  let earliest: string | null = null;
  for (const r of rides) {
    const date = irelandDateStr(new Date(r.startDate));
    const tss = computeTss(r.weightedAvgWatts ?? r.avgWatts, r.movingTimeMinutes, settings.ftpWatts) ?? 0;
    daily.set(date, (daily.get(date) ?? 0) + tss);
    if (!earliest || date < earliest) earliest = date;
  }
  if (!earliest) return null;
  const computed = computeFitnessSeries(daily, earliest, irelandTodayDateStr());
  const series = Array.from(computed, ([date, p]) => ({ date, ctl: p.ctl, atl: p.atl, tsb: p.tsb }));
  const today = series.at(-1);
  return today ? { ctl: today.ctl, atl: today.atl, tsb: today.tsb, source: "strava", series } : null;
}

const FORTNIGHT_DAYS = 14;
/** Zwift races rarely get marked as races on Strava, but their names give them away. */
const RACE_NAME = /\brace\b|racing|\bzrl\b|league|\bcrit|time trial|\btt\b|\bwtrl\b|tour de|series|\bcup\b|ladder|championship|grand prix/i;

/**
 * The last two weeks of riding, against the two weeks before: rides, hours,
 * kilometres and climbing, the longest ride, and the rides marked as races
 * in Strava or named like one (Strava doesn't know the placing, so none is given).
 */
export function lastFortnight(rides: Ride[]) {
  const day = 86_400_000;
  const now = Date.now();
  const inWindow = (r: Ride, fromDays: number, toDays: number) => {
    const age = now - Date.parse(r.startDate);
    return age >= fromDays * day && age < toDays * day;
  };
  const sum = (list: Ride[]) => ({
    rides: list.length,
    hours: Math.round(list.reduce((a, r) => a + r.movingTimeMinutes, 0) / 6) / 10,
    km: Math.round(list.reduce((a, r) => a + r.distanceKm, 0)),
    climbM: Math.round(list.reduce((a, r) => a + r.elevationGainM, 0)),
  });
  const recent = rides.filter((r) => inWindow(r, 0, FORTNIGHT_DAYS));
  const before = rides.filter((r) => inWindow(r, FORTNIGHT_DAYS, FORTNIGHT_DAYS * 2));
  const longest = recent.reduce<Ride | null>((a, r) => (!a || r.distanceKm > a.distanceKm ? r : a), null);
  return {
    last14Days: sum(recent),
    previous14Days: sum(before),
    longestRide: longest && { name: longest.name, km: longest.distanceKm, date: longest.startDate.slice(0, 10) },
    races: recent
      .filter((r) => r.race || RACE_NAME.test(r.name))
      .slice(0, 6)
      .map((r) => ({ name: r.name, date: r.startDate.slice(0, 10), km: r.distanceKm, minutes: r.movingTimeMinutes, avgWatts: r.weightedAvgWatts ?? r.avgWatts })),
  };
}

/** Which way fitness, fatigue and form have gone over the fortnight. */
export function fortnightTrend(series: FitnessPoint[]) {
  const today = series.at(-1);
  const then = series.at(-1 - FORTNIGHT_DAYS);
  if (!today || !then) return null;
  const d = (a: number | null, b: number | null) => (a != null && b != null ? Math.round(a - b) : null);
  return { ctlChange: d(today.ctl, then.ctl), atlChange: d(today.atl, then.atl), tsbChange: d(today.tsb, then.tsb) };
}

function round(n: number | null | undefined): number | null {
  return n == null || !Number.isFinite(n) ? null : Math.round(n);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyRaceCors(req, (name, value) => res.setHeader(name, value));
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (!getRaceAuthEmail(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Each source on its own: a Garmin outage shouldn't hide the TrainingPeaks numbers.
  // A generous ride count: CTL's 42-day window and the fortnight comparison need history. No elevation profiles.
  const rides = await fetchStravaRides(200, 0).catch((e) => {
    console.error("race-fitness: rides", e);
    return null;
  });
  const [fitness, context] = await Promise.all([
    currentFitness(rides).catch((e) => {
      console.error("race-fitness: fitness", e);
      return null;
    }),
    computeChatContext().catch((e) => {
      console.error("race-fitness: readings", e);
      return null;
    }),
  ]);

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    asOf: new Date().toISOString(),
    fitnessCtl: round(fitness?.ctl),
    fatigueAtl: round(fitness?.atl),
    formTsb: round(fitness?.tsb),
    fitnessSource: fitness?.source ?? null,
    ftpWatts: context?.ftpWatts ?? null,
    weightKg: context?.latestWeightKg != null ? Math.round(context.latestWeightKg * 10) / 10 : null,
    readiness: context?.readiness ?? null,
    hrvStatus: context?.hrvStatus ?? null,
    hrvMs: context?.hrvMs ?? null,
    hrvWeeklyMs: context?.hrvWeeklyMs ?? null,
    restingHeartRate: context?.restingHeartRate ?? null,
    sleepHours: context?.sleepHours ?? null,
    sleepScore: context?.sleepScore ?? null,
    bodyBattery: context?.bodyBattery ?? null,
    recoveryTimeHours: context?.recoveryTimeHours ?? null,
    acuteLoad: context?.acuteLoad ?? null,
    trainingPhase: context?.phase ?? null,
    riddenTodayKm: context?.hasRiddenToday ? context.todayDistanceKm : 0,
    recentTraining: rides ? lastFortnight(rides) : null,
    fitnessTrend14Days: fitness ? fortnightTrend(fitness.series) : null,
  });
}
