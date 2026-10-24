import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyRaceCors, getRaceAuthEmail } from "../_lib/raceToken.js";
import { computeChatContext } from "../_lib/coachSnapshot.js";
import { computeFitnessSeries } from "../_lib/fitness.js";
import { computeTss } from "../_lib/tss.js";
import { irelandDateStr, irelandTodayDateStr } from "../_lib/timeContext.js";
import { fetchStravaRides } from "./strava-activities.js";
import { fetchCoachingSettings } from "./coaching-settings.js";
import { fetchTrainingPeaksData } from "./trainingpeaks.js";

/**
 * The athlete's own fitness going into a race, for the Race console's coach
 * and commentator: fitness, fatigue and form (CTL, ATL, TSB), how ready
 * Garmin says they are today, and what they've already ridden today.
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

async function currentFitness(): Promise<Fitness | null> {
  const tp = await fetchTrainingPeaksData().catch(() => null);
  const latestTp = tp?.fitness?.filter((p) => p.ctl != null).at(-1);
  if (latestTp) return { ctl: latestTp.ctl, atl: latestTp.atl, tsb: latestTp.tsb, source: "trainingpeaks" };

  // A generous ride count so CTL's 42-day window has real history behind it.
  const [rides, settings] = await Promise.all([fetchStravaRides(200), fetchCoachingSettings()]);
  const daily = new Map<string, number>();
  let earliest: string | null = null;
  for (const r of rides) {
    const date = irelandDateStr(new Date(r.startDate));
    const tss = computeTss(r.weightedAvgWatts ?? r.avgWatts, r.movingTimeMinutes, settings.ftpWatts) ?? 0;
    daily.set(date, (daily.get(date) ?? 0) + tss);
    if (!earliest || date < earliest) earliest = date;
  }
  if (!earliest) return null;
  const today = Array.from(computeFitnessSeries(daily, earliest, irelandTodayDateStr()).values()).at(-1);
  return today ? { ctl: today.ctl, atl: today.atl, tsb: today.tsb, source: "strava" } : null;
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
  const [fitness, context] = await Promise.all([
    currentFitness().catch((e) => {
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
  });
}
