import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Resvg } from "@resvg/resvg-js";
import path from "node:path";
import { fetchHealthHistory } from "./health-data.js";
import { fetchCoachingSettings } from "./coaching-settings.js";
import { irelandTodayDateStr } from "./_lib/timeContext.js";
import {
  bmiSvg,
  caloriesBalanceSvg,
  macroSplitSvg,
  noDataImage,
  verifyWidgetToken,
} from "./_lib/widgetImage.js";

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

function latestDateWith(history: Record<string, Record<string, HealthValue>>, match: RegExp): string | null {
  const dates = Object.keys(history).sort();
  for (let i = dates.length - 1; i >= 0; i--) {
    if (Object.keys(history[dates[i]]).some((name) => match.test(name))) return dates[i];
  }
  return null;
}

type HealthValue = { value: number; unit?: string };

function reading(day: Record<string, HealthValue> | undefined, patterns: RegExp[]): HealthValue | null {
  if (!day) return null;
  for (const pattern of patterns) {
    const key = Object.keys(day).find((name) => pattern.test(name));
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
      const date = latestDateWith(history, /weight|body_mass/i);
      const raw = reading(history[date ?? ""], [/weight|body_mass/i]);
      const settings = await fetchCoachingSettings();
      const heightCm = (settings as { heightCm?: number }).heightCm;
      if (date == null || raw == null || !heightCm) {
        svg = noDataImage("BMI", "Needs a weight reading and a height set in Settings.");
      } else {
        // BMI is kg/m² by definition, so the maths always runs in kilograms -
        // only the weight shown beside it follows the athlete's chosen system.
        const weightKg = toKg(raw.value, raw.unit);
        const heightM = heightCm / 100;
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
    } else {
      svg = noDataImage("Widget", "That widget can't be drawn as an image yet.");
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
