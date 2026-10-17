import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fetchGarminDays } from "../_lib/garminReadings.js";
import { irelandTodayDateStr } from "../_lib/timeContext.js";

// The public Follow page's recovery section. Deliberately open, unlike
// /api/health-data, and deliberately narrow: readiness, sleep score and Body
// Battery only - HRV, resting heart rate, weight and the rest of the health
// history stay behind sign-in.

const HISTORY_DAYS = 14;

function readinessLevel(score: number): string {
  if (score >= 95) return "Prime";
  if (score >= 75) return "High";
  if (score >= 50) return "Moderate";
  if (score >= 25) return "Low";
  return "Poor";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const days = await fetchGarminDays(HISTORY_DAYS + 2).catch(() => []);
  const latest = <T>(pick: (d: (typeof days)[number]) => T | null) => {
    for (const day of days) {
      const value = pick(day);
      if (value != null) return { value, date: day.date };
    }
    return null;
  };
  const readiness = latest((d) => d.readiness);
  const sleep = latest((d) => d.sleepScore);
  const battery = latest((d) => d.bodyBatteryLatest);
  const batteryDay = battery ? days.find((d) => d.date === battery.date) : undefined;
  const sleepDay = sleep ? days.find((d) => d.date === sleep.date) : undefined;

  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
  res.status(200).json({
    today: irelandTodayDateStr(),
    readiness: readiness ? { score: readiness.value, level: readinessLevel(readiness.value), date: readiness.date } : null,
    sleep: sleep ? { score: sleep.value, hours: sleepDay?.sleepHours ?? null, date: sleep.date } : null,
    bodyBattery: battery ? { level: battery.value, at: batteryDay?.bodyBatteryLatestAt ?? null, atWake: batteryDay?.bodyBatteryAtWake ?? null, date: battery.date } : null,
    // Newest first.
    history: days.slice(0, HISTORY_DAYS).map((d) => ({
      date: d.date,
      readiness: d.readiness,
      sleepScore: d.sleepScore,
      bodyBatteryAtWake: d.bodyBatteryAtWake,
    })),
  });
}
