import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Resvg } from "@resvg/resvg-js";
import path from "node:path";
import { fetchHealthHistory } from "./health-data.js";
import { fetchCoachingSettings } from "./coaching-settings.js";
import { irelandTodayDateStr } from "./_lib/timeContext.js";
import { isWeightFieldName } from "./_lib/weightField.js";
import {
  bmiSvg,
  caloriesBalanceSvg,
  chartSvg,
  goalCardSvg,
  goalProgressSvg,
  macroSplitSvg,
  noDataImage,
  performanceChartSvg,
  ringSvg,
  ringsRowSvg,
  statSvg,
  timelineSvg,
  verifyWidgetToken,
  weatherSvg,
} from "./_lib/widgetImage.js";
import { fetchLastLocation } from "./last-location.js";
import { fetchWhoopHistory } from "./whoop-data.js";
import { fetchStravaRides } from "./strava-activities.js";
import { computeTss } from "./_lib/tss.js";
import { computeFitnessSeries } from "./_lib/fitness.js";
import { getAtpWeekFor } from "./_lib/atpPlan.js";
import { irelandDateStr } from "./_lib/timeContext.js";
import { resolveMetric } from "./_lib/metricSeries.js";
import { getJSON } from "./_lib/kvStore.js";
import { resolveDeviceLayout } from "./_lib/deviceLayout.js";
import {
  effectiveDateRange,
  filterSeriesToRange,
  resolveDateRange,
  type PageDateRanges,
  type ResolvedRange,
  type WidgetDateRange,
} from "./_lib/dateRange.js";
import { fetchGoals } from "./trends-goals.js";
import { goalInsights, paceVerdict } from "./_lib/goalInsights.js";
import { convertValueUnit } from "./_lib/units.js";

// The metric id the performance chart is stored under, matching the browser's
// PERFORMANCE_CHART_ID.
const PERFORMANCE_CHART_METRIC = "strava.performanceChart";
// A phone-width image can only carry so many days legibly, whatever range is
// chosen.
const MAX_CHART_DAYS = 120;

/**
 * Renders one widget as a PNG for WhatsApp.
 *
 * Unauthenticated by necessity - Twilio fetches media URLs itself, with no
 * cookie - so access is controlled entirely by the signed token, which names a
 * single widget and expires (see widgetImage.ts). An unsigned or stale token
 * gets a 403 rather than a picture of the athlete's body composition.
 */

const IMAGE_WIDTH = 720;

/**
 * Fonts are vendored into the repo and bundled with this function (see
 * `functions.includeFiles` in vercel.json) rather than taken from the system:
 * the serverless runtime has no fonts installed, and resvg silently draws
 * nothing for a family it can't resolve - no error, just a chart with every
 * label missing. loadSystemFonts stays off so local and deployed renders are
 * identical instead of local quietly succeeding on a system font.
 */
const FONT_DIR = path.join(process.cwd(), "api", "_fonts");
const FONT_OPTIONS = {
  loadSystemFonts: false,
  fontFiles: [path.join(FONT_DIR, "Inter_400Regular.ttf"), path.join(FONT_DIR, "Inter_700Bold.ttf")],
  defaultFontFamily: "Inter",
};

// Twilio, and then WhatsApp, may each fetch the URL - regenerating per fetch
// is wasted work. Private caching only: this is personal data on a URL that
// stops working shortly anyway.
const CACHE_CONTROL = "private, max-age=600";

// Most Apple Health fields are picked out by a pattern, but weight needs an
// exclusion too ("body_mass_index" is not a body mass), so a matcher can be
// either. WEIGHT_FIELD is the one shared with the dashboard.
type NameMatch = RegExp | ((name: string) => boolean);
const WEIGHT_FIELD: NameMatch = isWeightFieldName;

function matches(match: NameMatch, name: string): boolean {
  return typeof match === "function" ? match(name) : match.test(name);
}

function latestDateWith(history: Record<string, Record<string, HealthValue>>, match: NameMatch): string | null {
  const dates = Object.keys(history).sort();
  for (let i = dates.length - 1; i >= 0; i--) {
    if (Object.keys(history[dates[i]]).some((name) => matches(match, name))) return dates[i];
  }
  return null;
}

type HealthValue = { value: number; unit?: string };

function reading(day: Record<string, HealthValue> | undefined, patterns: NameMatch[]): HealthValue | null {
  if (!day) return null;
  for (const pattern of patterns) {
    const key = Object.keys(day).find((name) => matches(pattern, name));
    if (key) return day[key];
  }
  return null;
}

function field(day: Record<string, HealthValue> | undefined, patterns: RegExp[]): number | null {
  return reading(day, patterns)?.value ?? null;
}

const LB_TO_KG = 0.45359237;
const KG_TO_LB = 1 / LB_TO_KG;

/**
 * Apple Health exports body mass in whatever unit the athlete's device is set
 * to, so the stored number is only kilograms if it says so. Taking it raw put
 * 72kg on screen as "158.7 kg" and a BMI of 55.6 - the same trap the dashboard
 * avoids by converting through the catalog's own unit (see bmi.ts).
 */
function toKg(value: number, unit?: string): number {
  return /^(lb|lbs|pound)/i.test(unit ?? "") ? value * LB_TO_KG : value;
}

function dayLabel(date: string): string {
  const today = irelandTodayDateStr();
  if (date === today) return "Today";
  const yesterday = new Date(`${today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (date === yesterday.toISOString().slice(0, 10)) return "Yesterday";
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}


function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000);
}

/**
 * The two dated goals as a progress card.
 *
 * Weight has a real starting reading to measure from, so its bar shows how far
 * it has actually travelled. FTP is a tested figure entered in Settings with no
 * history behind it, so its bar reads as a fraction of the target - the same
 * distinction the dashboard's own goal cards make.
 */
async function goalImage(
  metric: string,
  history: Record<string, Record<string, HealthValue>>,
): Promise<string> {
  const goals = await fetchGoals();
  const settings = (await fetchCoachingSettings()) as { ftpWatts?: number; unitSystem?: string };
  const system = settings.unitSystem === "imperial" ? "imperial" : "metric";
  const today = irelandTodayDateStr();

  const weightDates = Object.keys(history)
    .filter((d) => Object.keys(history[d]).some((n) => isWeightFieldName(n)))
    .sort();
  const readingOn = (date: string) => reading(history[date], [WEIGHT_FIELD]);
  const latestKg = weightDates.length ? toKg(readingOn(weightDates.at(-1) as string)!.value, readingOn(weightDates.at(-1) as string)!.unit) : null;

  if (metric === "goal.weight") {
    const targetKg = goals.weightKg ?? null;
    if (latestKg == null || targetKg == null) {
      return noDataImage("Weight vs goal", "Needs a weight reading and a weight target in Settings.");
    }
    const daysLeft = goals.weightTargetDate ? daysBetween(today, goals.weightTargetDate) : null;
    const gapKg = latestKg - targetKg;
    const display = (kg: number) => convertValueUnit(kg, "kg", system);
    const shown = display(latestKg);
    const unit = shown.unit;

    // Every reading, in the athlete's units, so the chart and the insights are
    // computed on the same numbers that get printed.
    const series = weightDates.map((date) => {
      const r = readingOn(date)!;
      return { date, value: Math.round(display(toKg(r.value, r.unit)).value * 100) / 100 };
    });
    const target = display(targetKg).value;

    return goalCardSvg({
      title: "Weight vs goal",
      unit,
      series,
      target,
      targetDate: goals.weightTargetDate,
      current: shown.value,
      direction: "down",
      insights: goalInsights(series, target, unit, "down", today),
      pace: goals.weightTargetDate ? paceVerdict(series, target, goals.weightTargetDate, "down", today) : null,
      daysLeft,
      perWeekNeeded: daysLeft && daysLeft > 0 ? display(gapKg).value / (daysLeft / 7) : null,
      reached: gapKg <= 0,
    });
  }

  const currentFtp = settings.ftpWatts ?? null;
  const targetFtp = goals.ftpTargetWatts ?? null;
  if (currentFtp == null || targetFtp == null) {
    return noDataImage("FTP vs goal", "Needs an FTP in Settings and an FTP target.");
  }
  const daysLeft = goals.ftpTargetDate ? daysBetween(today, goals.ftpTargetDate) : null;
  // Power-to-weight on both sides, target divided by the target weight so the
  // two goals describe the same end state - matching the dashboard.
  const targetWeightKg = goals.weightKg ?? latestKg;
  return goalProgressSvg({
    title: "FTP vs goal",
    current: currentFtp,
    target: targetFtp,
    unit: "W",
    progress: currentFtp / targetFtp,
    currentSecondary: latestKg ? `${(currentFtp / latestKg).toFixed(2)} W/kg` : undefined,
    targetSecondary: targetWeightKg ? `${(targetFtp / targetWeightKg).toFixed(2)} W/kg` : undefined,
    deadline: goals.ftpTargetDate,
    daysLeft,
    perWeekNeeded: daysLeft && daysLeft > 0 ? (targetFtp - currentFtp) / (daysLeft / 7) : null,
    reached: currentFtp >= targetFtp,
  });
}


// Where to ask about the weather when nothing has been reported yet - the
// athlete's base, and the same fallback the dashboard's theme uses when
// geolocation is refused. Overwritten as soon as the dashboard reports a real
// position (see api/last-location.ts).
const IRELAND_FALLBACK = { latitude: 53.35, longitude: -6.26, place: "Ireland" };

async function weatherImage(system: "metric" | "imperial"): Promise<string> {
  const location = (await fetchLastLocation()) ?? IRELAND_FALLBACK;
  const tempUnit = system === "imperial" ? "fahrenheit" : "celsius";
  const windUnit = system === "imperial" ? "mph" : "kmh";
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}` +
    `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=7&timezone=auto` +
    `&temperature_unit=${tempUnit}&wind_speed_unit=${windUnit}`;

  const res = await fetch(url);
  if (!res.ok) return noDataImage("Weather", "Couldn't reach the weather service.");
  const body = (await res.json()) as {
    current?: Record<string, number>;
    daily?: { time?: string[]; weather_code?: number[]; temperature_2m_max?: number[]; temperature_2m_min?: number[] };
  };
  const c = body.current;
  if (!c) return noDataImage("Weather", "No current conditions returned.");

  return weatherSvg({
    place: "place" in location ? (location as { place?: string }).place : undefined,
    temperature: c.temperature_2m,
    apparent: c.apparent_temperature,
    code: c.weather_code,
    windSpeed: c.wind_speed_10m,
    humidity: c.relative_humidity_2m,
    tempUnit: system === "imperial" ? "°F" : "°C",
    windUnit: system === "imperial" ? "mph" : "km/h",
    days: (body.daily?.time ?? []).map((date, i) => ({
      date,
      code: body.daily?.weather_code?.[i] ?? 0,
      max: body.daily?.temperature_2m_max?.[i] ?? 0,
      min: body.daily?.temperature_2m_min?.[i] ?? 0,
    })),
  });
}

/** CTL/ATL/TSB from the same computation the coach's get_fitness tool uses. */
/**
 * The window a picture of a widget should draw.
 *
 * A WhatsApp image is meant to be the widget, not a lookalike, so it uses the
 * same range the widget on the dashboard is using: that widget's own range if
 * one was set on it, otherwise the Dashboard default from Settings. The coach
 * asks for a metric rather than a widget id, so the saved layout is searched
 * for a widget on that metric - if the athlete has none, the page default is
 * still the right answer.
 */
async function rangeForMetric(metric: string): Promise<ResolvedRange> {
  const [settings, layout] = await Promise.all([
    fetchCoachingSettings().catch(() => ({}) as Record<string, unknown>),
    getJSON<unknown>("DASHBOARD_LAYOUT").catch(() => null),
  ]);
  const widgets = resolveDeviceLayout<{ metric?: string; dateRange?: WidgetDateRange }>(layout, "desktop");
  const own = widgets.find((w) => w.metric === metric)?.dateRange;
  const pageRanges = (settings as { pageDateRanges?: PageDateRanges }).pageDateRanges;
  return resolveDateRange(effectiveDateRange(own, "dashboard", pageRanges));
}

async function performanceImage(): Promise<string> {
  const [rides, settings] = await Promise.all([fetchStravaRides(200), fetchCoachingSettings()]);
  const dailyTssByDate = new Map<string, number>();
  let earliest: string | null = null;
  for (const r of rides) {
    const date = irelandDateStr(new Date(r.startDate));
    const tss = computeTss(r.weightedAvgWatts ?? r.avgWatts, r.movingTimeMinutes, (settings as { ftpWatts?: number }).ftpWatts) ?? 0;
    dailyTssByDate.set(date, (dailyTssByDate.get(date) ?? 0) + tss);
    if (!earliest || date < earliest) earliest = date;
  }
  const today = irelandTodayDateStr();
  if (!earliest) return noDataImage("ATP Progress / Performance Chart", "No ride history yet.");

  const series = computeFitnessSeries(dailyTssByDate, earliest, today);
  // The window the dashboard's own performance chart is set to, rather than a
  // fixed slice - a picture of the chart should cover the same days as the
  // chart. Still capped, because a year of days at phone width is a smear.
  const range = await rangeForMetric(PERFORMANCE_CHART_METRIC);
  const points = filterSeriesToRange(Array.from(series.values()), range).slice(-MAX_CHART_DAYS);
  const week = getAtpWeekFor(today);
  return performanceChartSvg(points, { ctl: week?.targetCtl ?? null, tsb: week?.targetTsb ?? null });
}


/** Whoop's three-up summary for the most recent scored day. */
async function ringsImage(): Promise<string> {
  const { history } = await fetchWhoopHistory();
  type Day = {
    date: string;
    recovery?: { score?: number } | null;
    strain?: { score?: number } | null;
    sleep?: { performancePercent?: number } | null;
  };
  const days = (history as Day[])
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  if (days.length === 0) return noDataImage("Sleep, Recovery & Strain", "No Whoop history yet.");

  // Each ring falls back to the last day its own field was scored. Strain is
  // live all day while recovery and sleep arrive hours later, so reading the
  // newest cycle wholesale blanks two rings of three every morning - and the
  // athlete knows those numbers exist, because the watch is showing them.
  const newestScored = <K extends "recovery" | "strain" | "sleep">(key: K) => {
    for (let i = days.length - 1; i >= 0; i--) {
      const value = days[i][key];
      if (value) return { value, date: days[i].date };
    }
    return null;
  };
  const recovery = newestScored("recovery");
  const strain = newestScored("strain");
  const sleep = newestScored("sleep");

  // Dated by the freshest thing on the card, with a note when the others are
  // older, so nothing older is passed off as today's.
  const dates = [recovery?.date, strain?.date, sleep?.date].filter((d): d is string => !!d).sort();
  const newest = dates.at(-1);
  const mixed = dates.length > 1 && irelandDateStr(new Date(dates[0])) !== irelandDateStr(new Date(newest as string));

  return ringsRowSvg({
    sleepPerformance: sleep?.value.performancePercent ?? null,
    recovery: recovery?.value.score ?? null,
    strain: strain?.value.score ?? null,
    dateLabel: newest
      ? `${dayLabel(irelandDateStr(new Date(newest)))}${mixed ? " · recovery and sleep from the last scored night" : ""}`
      : "",
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.SESSION_SECRET;
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const spec = secret ? verifyWidgetToken(token, secret) : null;

  if (!spec) {
    res.status(403).send("Invalid or expired link");
    return;
  }

  try {
    const history = (await fetchHealthHistory(120)) as Record<string, Record<string, HealthValue>>;
    let svg: string;

    if (spec.metric === "health.bmi") {
      const date = latestDateWith(history, WEIGHT_FIELD);
      const raw = reading(history[date ?? ""], [WEIGHT_FIELD]);
      const settings = await fetchCoachingSettings();
      const heightCm = (settings as { heightCm?: number }).heightCm;
      if (date == null || raw == null || !heightCm) {
        svg = noDataImage("BMI", "Needs a weight reading and a height set in Settings.");
      } else {
        // BMI is kg/m² by definition, so the maths always runs in kilograms -
        // only the weight shown beside it follows the athlete's chosen system.
        const weightKg = toKg(raw.value, raw.unit);
        const heightM = heightCm / 100;
        // Metric unless imperial has been chosen - same default as everywhere else.
        const imperial = (settings as { unitSystem?: string }).unitSystem === "imperial";
        svg = bmiSvg(
          Math.round((weightKg / (heightM * heightM)) * 10) / 10,
          imperial ? { value: weightKg * KG_TO_LB, unit: "lb" } : { value: weightKg, unit: "kg" },
          dayLabel(date),
        );
      }
    } else if (spec.metric === "health.macroSplit") {
      const date = latestDateWith(history, /carbohydrate|protein|fat/i);
      const day = history[date ?? ""];
      svg =
        date == null
          ? noDataImage("Macro split", "No macros logged yet.")
          : macroSplitSvg(
              {
                carbs: field(day, [/carbohydrate/i]),
                fat: field(day, [/^total_fat$/i, /fat/i]),
                protein: field(day, [/^protein$/i]),
              },
              dayLabel(date),
            );
    } else if (spec.metric === "health.caloriesBalance") {
      const date = latestDateWith(history, /dietary_energy|active_energy/i);
      const day = history[date ?? ""];
      const active = field(day, [/active_energy/i]);
      const basal = field(day, [/basal_energy|resting_energy/i]);
      svg =
        date == null
          ? noDataImage("Consumed vs burned", "No energy data yet.")
          : caloriesBalanceSvg(
              field(day, [/dietary_energy/i]),
              active == null && basal == null ? null : (active ?? 0) + (basal ?? 0),
              dayLabel(date),
            );
    } else if (spec.metric === "goal.weight" || spec.metric === "goal.ftp") {
      svg = await goalImage(spec.metric, history);
    } else if (spec.metric === "weather.current") {
      const s = (await fetchCoachingSettings()) as { unitSystem?: string };
      svg = await weatherImage(s.unitSystem === "imperial" ? "imperial" : "metric");
    } else if (spec.metric === "strava.performanceChart") {
      svg = await performanceImage();
    } else if (spec.metric === "whoop.sleepRecoveryStrainRings") {
      svg = await ringsImage();
    } else {
      // Anything else is a plain metric: resolve its series and draw it in the
      // requested view. This is what makes the whole catalog available rather
      // than a hand-picked handful.
      const resolved = await resolveMetric(spec.metric);
      if (!resolved) {
        svg = noDataImage("Widget", `Nothing tracked under "${spec.metric}".`);
      } else {
        const range = await rangeForMetric(spec.metric);
        resolved.series = filterSeriesToRange(resolved.series, range);
        const last = resolved.series.at(-1) ?? null;
        const when = last ? dayLabel(last.date) : "";
        svg =
          spec.view === "chart"
            ? chartSvg(resolved.label, resolved.series, resolved.unit)
            : spec.view === "timeline"
              ? timelineSvg(resolved.label, resolved.series, resolved.unit)
              : spec.view === "ring"
                ? ringSvg(resolved.label, last?.value ?? null, resolved.unit, when)
                : statSvg(resolved.label, last?.value ?? null, resolved.unit, when);
      }
    }

    const png = new Resvg(svg, { fitTo: { mode: "width", value: IMAGE_WIDTH }, font: FONT_OPTIONS }).render().asPng();
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", CACHE_CONTROL);
    res.status(200).send(png);
  } catch (error) {
    console.error("widget-image", spec.metric, error);
    res.status(500).send("Could not render that widget");
  }
}
