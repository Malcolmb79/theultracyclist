import { irelandMinutesSinceMidnight } from "./irelandDate";

export interface CalorieBurnEstimateConfig {
  wakeTime: string; // "HH:MM", 24h
  targetTime: string; // "HH:MM", 24h - when dailyTargetKcal is expected to be fully burned
  dailyTargetKcal: number;
}

export const DEFAULT_CALORIE_BURN_ESTIMATE: CalorieBurnEstimateConfig = {
  wakeTime: "07:00",
  targetTime: "20:00",
  dailyTargetKcal: 1890,
};

function parseHHMM(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

// A live, linear ramp from 0 kcal at wakeTime to dailyTargetKcal at
// targetTime - not a substitute for a real Active/Basal Energy reading,
// just a stand-in for "roughly how much will I have burned by now" on a
// day Apple Health hasn't synced (or hasn't caught up) yet. Real burn
// isn't actually linear across the day, but a straight ramp is the
// simplest shape that satisfies "starts at 0 on waking, reaches the
// target by evening" without inventing a more elaborate curve the coach
// never asked for.
export function estimateCalorieBurnNow(config: CalorieBurnEstimateConfig, now: Date = new Date()): number | null {
  const wakeMinutes = parseHHMM(config.wakeTime);
  const targetMinutes = parseHHMM(config.targetTime);
  if (wakeMinutes == null || targetMinutes == null || targetMinutes <= wakeMinutes) return null;
  if (!Number.isFinite(config.dailyTargetKcal) || config.dailyTargetKcal <= 0) return null;

  const nowMinutes = irelandMinutesSinceMidnight(now);
  if (nowMinutes <= wakeMinutes) return 0;
  if (nowMinutes >= targetMinutes) return config.dailyTargetKcal;

  const fraction = (nowMinutes - wakeMinutes) / (targetMinutes - wakeMinutes);
  return Math.round(config.dailyTargetKcal * fraction);
}
