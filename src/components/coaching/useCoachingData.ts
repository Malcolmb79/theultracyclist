import { useMemo } from "react";
import type { CoachingSettings, Readiness, RideZoneClassification, WeeklyProgress } from "./types";
import { computeReadiness } from "./readiness";
import { classifyPower } from "./powerZones";
import type { RawSourcesState } from "../../utils/useRawSources";
import { irelandDateStr, irelandTodayDateStr, whoopDayStr } from "../../utils/irelandDate";

type WhoopDayRaw = {
  date: string;
  recovery: { score: number; hrvMs: number; restingHeartRate: number } | null;
  strain: { score: number } | null;
  sleep: { performancePercent: number } | null;
};

type StravaRide = {
  id: number;
  name: string;
  startDate: string;
  distanceKm: number;
  movingTimeMinutes: number;
  avgWatts: number | null;
  weightedAvgWatts: number | null;
};

export type CoachingDataState =
  | { status: "loading" }
  | {
      status: "ready";
      readiness: Readiness;
      settings: CoachingSettings;
      saveSettings: (next: CoachingSettings) => Promise<void>;
      weeklyProgress: WeeklyProgress;
      recentRides: RideZoneClassification[];
      recoveryHistory: {
        date: string;
        recovery: number | null;
        strain: number | null;
        hrvMs: number | null;
        restingHeartRate: number | null;
        sleepPerformance: number | null;
      }[];
      // False when the underlying Whoop/Strava fetches didn't actually
      // succeed (vs. succeeding with genuinely no data) - lets the coach
      // chat card wait to speak rather than opening on an empty snapshot.
      dataAvailable: boolean;
      // Whether a ride's already been logged today (local calendar day) -
      // so the coach can tell "haven't ridden yet" apart from "already
      // trained" instead of asking what's on the schedule after the fact.
      hasRiddenToday: boolean;
      todayDistanceKm: number | null;
      // Whether recoveryHistory's latest entry is actually today's reading
      // (Ireland-local) rather than a stale previous day's still showing
      // because today's hasn't landed from Whoop yet (recovery/sleep are a
      // once-daily morning reading - see DATA_SEMANTICS in
      // api/_lib/coachContext.ts). Lets the readiness card show a waiting
      // placeholder instead of quietly presenting yesterday's numbers as
      // if they were today's.
      readinessDataIsFresh: boolean;
    };

// Monday-start week, not JS's default Sunday-start - matches how the
// athlete actually tracks their training week. Pure calendar-string
// arithmetic (no timezone conversion needed here) - the caller is
// responsible for passing in an already Ireland-correct date string.
function startOfWeek(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d.toISOString().slice(0, 10);
}

export function useCoachingData(raw: RawSourcesState): CoachingDataState {
  return useMemo<CoachingDataState>(() => {
    if (raw.status !== "ready") return { status: "loading" };

    const whoop = raw.whoop as { history?: WhoopDayRaw[] } | null;
    const strava = raw.strava as { rides?: StravaRide[] } | null;

    // Both resolving null means the fetches came back non-ok (outage, stale
    // token, etc.), not "no data yet" - don't let the coach open on an empty
    // snapshot in that case.
    const dataAvailable = whoop != null && strava != null;
    const settings = raw.settings as CoachingSettings;
    const whoopDays = (whoop?.history ?? []).slice().reverse(); // oldest first
    const rides = strava?.rides ?? [];

      const recoveryHistory = whoopDays.map((d) => ({
        date: whoopDayStr(new Date(d.date)),
        recovery: d.recovery?.score ?? null,
        strain: d.strain?.score ?? null,
        hrvMs: d.recovery?.hrvMs ?? null,
        restingHeartRate: d.recovery?.restingHeartRate ?? null,
        sleepPerformance: d.sleep?.performancePercent ?? null,
      }));

      const latest = recoveryHistory[recoveryHistory.length - 1];
      const last3Strain = recoveryHistory
        .slice(-3)
        .map((d) => d.strain)
        .filter((v): v is number => v != null);
      const recentAvgStrain = last3Strain.length > 0 ? last3Strain.reduce((a, b) => a + b, 0) / last3Strain.length : null;

      const readiness = computeReadiness(latest?.recovery ?? null, recentAvgStrain != null ? Math.round(recentAvgStrain * 10) / 10 : null);

      const todayStr = irelandTodayDateStr();
      const readinessDataIsFresh = latest?.date === todayStr;
      const weekStart = startOfWeek(todayStr);
      const thisWeekRides = rides.filter((r) => irelandDateStr(new Date(r.startDate)) >= weekStart);
      const weeklyProgress: WeeklyProgress = {
        distanceKm: Math.round(thisWeekRides.reduce((sum, r) => sum + r.distanceKm, 0) * 10) / 10,
        distanceTargetKm: settings.weeklyDistanceKm ?? null,
        hours: Math.round((thisWeekRides.reduce((sum, r) => sum + r.movingTimeMinutes, 0) / 60) * 10) / 10,
        hoursTargetHours: settings.weeklyHours ?? null,
        rideCount: thisWeekRides.length,
      };

      const todaysRides = rides.filter((r) => irelandDateStr(new Date(r.startDate)) === todayStr);
      const hasRiddenToday = todaysRides.length > 0;
      const todayDistanceKm = hasRiddenToday
        ? Math.round(todaysRides.reduce((sum, r) => sum + r.distanceKm, 0) * 10) / 10
        : null;

      const recentRides: RideZoneClassification[] = rides.slice(0, 8).map((r) => {
        const avgWatts = r.weightedAvgWatts ?? r.avgWatts ?? 0;
        return {
          rideId: r.id,
          name: r.name,
          date: r.startDate,
          avgWatts,
          zone: avgWatts > 0 ? classifyPower(avgWatts, settings.ftpWatts ?? null) : null,
        };
      });

    return {
      status: "ready",
      readiness,
      settings,
      saveSettings: raw.saveSettings as (next: CoachingSettings) => Promise<void>,
      weeklyProgress,
      recentRides,
      recoveryHistory,
      dataAvailable,
      hasRiddenToday,
      todayDistanceKm,
      readinessDataIsFresh,
    };
  }, [raw]);
}
