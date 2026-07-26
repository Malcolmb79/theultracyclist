import { fetchWhoopHistory } from "../whoop-data.js";
import { fetchStravaRides, type Ride } from "../strava-activities.js";
import { fetchCoachingSettings } from "../coaching-settings.js";
import type { ChatContext } from "../coaching-chat.js";
import { irelandDateStr, irelandTodayDateStr } from "./timeContext.js";

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
export async function computeChatContext(): Promise<Partial<ChatContext>> {
  const [whoop, rides, settings] = await Promise.all([
    fetchWhoopHistory().catch(() => null),
    fetchStravaRides().catch(() => [] as Ride[]),
    fetchCoachingSettings().catch(() => ({})),
  ]);

  const history = whoop?.history ?? []; // newest first
  const latest = history[0];
  const last3Strain = history
    .slice(0, 3)
    .map((d) => d.strain?.score)
    .filter((v): v is number => v != null);
  const recentAvgStrain =
    last3Strain.length > 0 ? Math.round((last3Strain.reduce((a, b) => a + b, 0) / last3Strain.length) * 10) / 10 : null;

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
    recoveryScore: latest?.recovery?.score ?? null,
    hrvMs: latest?.recovery?.hrvMs ?? null,
    restingHeartRate: latest?.recovery?.restingHeartRate ?? null,
    strainScore: latest?.strain?.score ?? null,
    recentAvgStrain,
    sleepPerformance: latest?.sleep?.performancePercent ?? null,
    weeklyDistanceKm,
    weeklyTargetKm: settings.weeklyDistanceKm ?? null,
    phase: settings.phase ?? null,
    customRules: settings.customRules ?? null,
    hasRiddenToday,
    todayDistanceKm,
  };
}
