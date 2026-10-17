import { fetchHealthHistory } from "../_routes/health-data.js";
import { getJSON } from "./kvStore.js";
import { irelandTodayDateStr } from "./timeContext.js";

// The coach's view of the Garmin data that scripts/garmin-sync.mjs writes
// into the health history as flat garmin_* fields. Read straight from Redis,
// so there is no third-party token to race and every channel (browser chat,
// WhatsApp, the daily note) can read it server-side.

// Codes written by scripts/garmin-sync.mjs (HRV_STATUS_CODES).
const HRV_STATUS: Record<number, string> = { 0: "no status yet (still establishing a baseline)", 1: "poor", 2: "low", 3: "unbalanced", 4: "balanced" };

export type GarminDay = {
  date: string;
  readiness: number | null;
  readinessFactors: { sleep: number | null; recoveryTime: number | null; hrv: number | null; loadBalance: number | null; stressHistory: number | null; sleepHistory: number | null };
  recoveryTimeHours: number | null;
  sleepScore: number | null;
  sleepHours: number | null;
  sleepNeedHours: number | null;
  deepHours: number | null;
  remHours: number | null;
  lightHours: number | null;
  awakeHours: number | null;
  hrvMs: number | null;
  hrvWeeklyMs: number | null;
  hrvStatus: string | null;
  restingHeartRate: number | null;
  bodyBatteryLatest: number | null;
  /** Irish clock time of the latest Body Battery reading, "HH:MM". */
  bodyBatteryLatestAt: string | null;
  bodyBatteryAtWake: number | null;
  bodyBatteryHigh: number | null;
  bodyBatteryLow: number | null;
  bodyBatteryCharged: number | null;
  bodyBatteryDrained: number | null;
  avgStress: number | null;
  /** Sum of the day's activity training loads; 0 on a day with readings but no activity. */
  trainingLoad: number;
  acuteLoad7Day: number | null;
  activityMinutes: number;
  steps: number | null;
};

function clock(minutes: number | null): string | null {
  if (minutes == null) return null;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const round1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);

/** Newest first, days with any Garmin reading only. */
export async function fetchGarminDays(days = 30): Promise<GarminDay[]> {
  const history = await fetchHealthHistory(days);
  const out: GarminDay[] = [];
  for (const date of Object.keys(history).sort().reverse()) {
    const fields = history[date];
    if (!Object.keys(fields).some((name) => name.startsWith("garmin_"))) continue;
    const read = (name: string): number | null => fields[`garmin_${name}`]?.value ?? null;
    const statusCode = read("hrv_status");
    out.push({
      date,
      readiness: read("training_readiness"),
      readinessFactors: {
        sleep: read("readiness_sleep"),
        recoveryTime: read("readiness_recovery"),
        hrv: read("readiness_hrv"),
        loadBalance: read("readiness_load"),
        stressHistory: read("readiness_stress"),
        sleepHistory: read("readiness_sleep_history"),
      },
      recoveryTimeHours: round1(read("recovery_time")),
      sleepScore: read("sleep_score"),
      sleepHours: round1(read("sleep_hours")),
      sleepNeedHours: round1(read("sleep_need_hours")),
      deepHours: round1(read("sleep_deep_hours")),
      remHours: round1(read("sleep_rem_hours")),
      lightHours: round1(read("sleep_light_hours")),
      awakeHours: round1(read("sleep_awake_hours")),
      hrvMs: read("hrv"),
      hrvWeeklyMs: read("hrv_weekly"),
      hrvStatus: statusCode == null ? null : (HRV_STATUS[statusCode] ?? null),
      restingHeartRate: read("resting_hr"),
      bodyBatteryLatest: read("body_battery"),
      bodyBatteryLatestAt: clock(read("body_battery_at")),
      bodyBatteryAtWake: read("body_battery_wake"),
      bodyBatteryHigh: read("body_battery_high"),
      bodyBatteryLow: read("body_battery_low"),
      bodyBatteryCharged: read("body_battery_charged"),
      bodyBatteryDrained: read("body_battery_drained"),
      avgStress: read("stress"),
      trainingLoad: Math.round(read("training_load") ?? 0),
      acuteLoad7Day: read("acute_load"),
      activityMinutes: Math.round(read("activity_minutes") ?? 0),
      steps: read("steps"),
    });
  }
  return out;
}

export type GarminReadings = {
  readiness: number | null;
  readinessDate: string | null;
  hrvMs: number | null;
  hrvWeeklyMs: number | null;
  hrvStatus: string | null;
  hrvDate: string | null;
  restingHeartRate: number | null;
  restingHeartRateDate: string | null;
  sleepScore: number | null;
  sleepHours: number | null;
  sleepNeedHours: number | null;
  sleepDate: string | null;
  bodyBattery: number | null;
  bodyBatteryAt: string | null;
  bodyBatteryAtWake: number | null;
  bodyBatteryDate: string | null;
  trainingLoadToday: number | null;
  recentAvgLoad: number | null;
  acuteLoad: number | null;
  acuteLoadDate: string | null;
  recoveryTimeHours: number | null;
  recoveryTimeDate: string | null;
};

/**
 * The latest value of each Garmin reading with the day it came from. Each
 * falls back independently: sleep is scored on waking, readiness refreshes
 * through the morning and Body Battery every sync, so the newest day is often
 * part-filled and the readings can come from different days.
 */
export function readingsFromDays(days: GarminDay[]): GarminReadings {
  const latest = <T>(pick: (d: GarminDay) => T | null): { value: T; day: GarminDay } | null => {
    for (const day of days) {
      const value = pick(day);
      if (value != null) return { value, day };
    }
    return null;
  };
  const readiness = latest((d) => d.readiness);
  const hrv = latest((d) => d.hrvMs);
  const rhr = latest((d) => d.restingHeartRate);
  const sleep = latest((d) => d.sleepScore);
  const battery = latest((d) => d.bodyBatteryLatest);
  const acute = latest((d) => d.acuteLoad7Day);
  const recovery = latest((d) => d.recoveryTimeHours);

  const today = irelandTodayDateStr();
  const todayRecord = days.find((d) => d.date === today);
  // Complete days only: today's load is still accumulating.
  const previous = days.filter((d) => d.date < today).slice(0, 3);

  return {
    readiness: readiness?.value ?? null,
    readinessDate: readiness?.day.date ?? null,
    hrvMs: hrv?.value ?? null,
    hrvWeeklyMs: hrv?.day.hrvWeeklyMs ?? null,
    hrvStatus: hrv?.day.hrvStatus ?? null,
    hrvDate: hrv?.day.date ?? null,
    restingHeartRate: rhr?.value ?? null,
    restingHeartRateDate: rhr?.day.date ?? null,
    sleepScore: sleep?.value ?? null,
    sleepHours: sleep?.day.sleepHours ?? null,
    sleepNeedHours: sleep?.day.sleepNeedHours ?? null,
    sleepDate: sleep?.day.date ?? null,
    bodyBattery: battery?.value ?? null,
    bodyBatteryAt: battery?.day.bodyBatteryLatestAt ?? null,
    bodyBatteryAtWake: battery?.day.bodyBatteryAtWake ?? null,
    bodyBatteryDate: battery?.day.date ?? null,
    trainingLoadToday: todayRecord ? todayRecord.trainingLoad : null,
    recentAvgLoad: previous.length > 0 ? Math.round(previous.reduce((sum, d) => sum + d.trainingLoad, 0) / previous.length) : null,
    acuteLoad: acute?.value ?? null,
    acuteLoadDate: acute?.day.date ?? null,
    recoveryTimeHours: recovery?.value ?? null,
    recoveryTimeDate: recovery?.day.date ?? null,
  };
}

export async function latestGarminReadings(): Promise<GarminReadings> {
  return readingsFromDays(await fetchGarminDays(14).catch(() => []));
}

type TimelinePoint = [number, number | null, number | null, 0 | 1];
type TimelineDay = {
  date: string;
  dayStart: number;
  dayEnd: number;
  sleep: { start: number; end: number } | null;
  points: TimelinePoint[];
  activities?: { start: number; end: number; name: string; type: string; load: number | null; calories: number | null }[];
};

const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Dublin", hour: "2-digit", minute: "2-digit" });

/**
 * One day of the Body Battery timeline, condensed for the coach: the raw
 * 3-minute series is ~480 points, far more than it needs to say what drained
 * the battery and when.
 */
export async function bodyBatteryDay(date?: string): Promise<unknown> {
  const timeline = (await getJSON<Record<string, TimelineDay>>("GARMIN_TIMELINE")) ?? {};
  const available = Object.keys(timeline).sort();
  const day = timeline[date ?? available.at(-1) ?? ""];
  if (!day) return { error: "No Body Battery timeline for that day.", availableDates: available };

  const batteryNear = (t: number): number | null => {
    let best: TimelinePoint | null = null;
    for (const p of day.points) if (p[2] != null && (!best || Math.abs(p[0] - t) < Math.abs(best[0] - t))) best = p;
    return best && Math.abs(best[0] - t) <= 15 * 60 * 1000 ? best[2] : null;
  };

  const hourly: { time: string; battery: number | null; avgStress: number | null }[] = [];
  for (let t = day.dayStart; t < day.dayEnd; t += 3600000) {
    const inHour = day.points.filter((p) => p[0] >= t && p[0] < t + 3600000);
    const stress = inHour.map((p) => p[1]).filter((v): v is number => v != null && v >= 0);
    hourly.push({
      time: time.format(t),
      battery: batteryNear(t),
      avgStress: stress.length ? Math.round(stress.reduce((a, b) => a + b, 0) / stress.length) : null,
    });
  }

  const stressValues = day.points.map((p) => p[1]).filter((v): v is number => v != null && v >= 0);
  const minutesIn = (test: (v: number) => boolean) => stressValues.filter(test).length * 3;
  return {
    date: day.date,
    availableDates: available,
    sleep: day.sleep ? { from: time.format(day.sleep.start), to: time.format(day.sleep.end) } : null,
    activities: (day.activities ?? []).map((a) => {
      const before = batteryNear(a.start);
      const after = batteryNear(a.end);
      return {
        name: a.name,
        type: a.type,
        from: time.format(a.start),
        to: time.format(a.end),
        trainingLoad: a.load,
        calories: a.calories,
        bodyBatteryChange: before != null && after != null ? after - before : null,
      };
    }),
    stressMinutes: {
      rest: minutesIn((v) => v <= 25),
      low: minutesIn((v) => v > 25 && v <= 50),
      medium: minutesIn((v) => v > 50 && v <= 75),
      high: minutesIn((v) => v > 75),
    },
    hourly: hourly.filter((h) => h.battery != null || h.avgStress != null),
  };
}
