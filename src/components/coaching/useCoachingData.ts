import { useMemo } from "react";
import type { CoachingSettings, Readiness, RideZoneClassification, WeeklyProgress } from "./types";
import { computeReadiness } from "./readiness";
import { classifyPower } from "./powerZones";
import type { RawSourcesState } from "../../utils/useRawSources";
import { irelandDateStr, irelandTodayDateStr } from "../../utils/irelandDate";
import { garminDaysFrom } from "../../utils/garmin";

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
      // False when the underlying Garmin/Strava fetches didn't actually
      // succeed (vs. succeeding with genuinely no data) - lets the coach
      // chat card wait to speak rather than opening on an empty snapshot.
      dataAvailable: boolean;
      // Whether a ride's already been logged today (local calendar day) -
      // so the coach can tell "haven't ridden yet" apart from "already
      // trained" instead of asking what's on the schedule after the fact.
      hasRiddenToday: boolean;
      todayDistanceKm: number | null;
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

    const health = raw.health as { history?: Record<string, Record<string, { value: number }>> } | null;
    const strava = raw.strava as { rides?: StravaRide[] } | null;

    // Both resolving null means the fetches came back non-ok (outage, stale
    // token, etc.), not "no data yet" - don't let the coach open on an empty
    // snapshot in that case.
    const dataAvailable = health != null && strava != null;
    const settings = raw.settings as CoachingSettings;
    const garminDays = garminDaysFrom(health?.history ?? {});
    const rides = strava?.rides ?? [];

      const todayStr = irelandTodayDateStr();
      const readiness = computeReadiness(garminDays, todayStr);
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
      dataAvailable,
      hasRiddenToday,
      todayDistanceKm,
    };
  }, [raw]);
}
