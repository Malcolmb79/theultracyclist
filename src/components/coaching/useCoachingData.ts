import { useEffect, useState } from "react";
import type { CoachingSettings, Readiness, RideZoneClassification, WeeklyProgress } from "./types";
import { computeReadiness } from "./readiness";
import { classifyPower } from "./powerZones";

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
    };

function startOfWeek(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

export function useCoachingData(): CoachingDataState {
  const [state, setState] = useState<CoachingDataState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch("/api/whoop-data").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/strava-activities").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/coaching-settings").then((r) => (r.ok ? r.json() : null)),
    ]).then(([whoop, strava, settingsBody]) => {
      if (cancelled) return;

      // Both fetches resolving null means they came back non-ok (outage,
      // stale token, etc.), not "no data yet" - don't let the coach open on
      // an empty snapshot in that case.
      const dataAvailable = whoop != null && strava != null;
      const settings: CoachingSettings = settingsBody?.settings ?? {};
      const whoopDays = ((whoop?.history as WhoopDayRaw[] | undefined) ?? []).slice().reverse(); // oldest first
      const rides = (strava?.rides as StravaRide[] | undefined) ?? [];

      const recoveryHistory = whoopDays.map((d) => ({
        date: d.date.slice(0, 10),
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

      const todayStr = new Date().toISOString().slice(0, 10);
      const weekStart = startOfWeek(todayStr);
      const thisWeekRides = rides.filter((r) => r.startDate.slice(0, 10) >= weekStart);
      const weeklyProgress: WeeklyProgress = {
        distanceKm: Math.round(thisWeekRides.reduce((sum, r) => sum + r.distanceKm, 0) * 10) / 10,
        distanceTargetKm: settings.weeklyDistanceKm ?? null,
        hours: Math.round((thisWeekRides.reduce((sum, r) => sum + r.movingTimeMinutes, 0) / 60) * 10) / 10,
        hoursTargetHours: settings.weeklyHours ?? null,
        rideCount: thisWeekRides.length,
      };

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

      const saveSettings = async (next: CoachingSettings) => {
        await fetch("/api/coaching-settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        });
        setState((prev) => (prev.status === "ready" ? { ...prev, settings: next } : prev));
      };

      setState({ status: "ready", readiness, settings, saveSettings, weeklyProgress, recentRides, recoveryHistory, dataAvailable });
    }).catch(() => {
      if (!cancelled) {
        setState({
          status: "ready",
          readiness: computeReadiness(null, null),
          settings: {},
          saveSettings: async () => {},
          weeklyProgress: { distanceKm: 0, distanceTargetKm: null, hours: 0, hoursTargetHours: null, rideCount: 0 },
          recentRides: [],
          recoveryHistory: [],
          dataAvailable: false,
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
