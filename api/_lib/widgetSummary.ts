import { fetchWhoopHistory } from "../whoop-data.js";
import { fetchHealthHistory } from "../health-data.js";
import { fetchCoachingSettings } from "../coaching-settings.js";
import { fetchGoals } from "../trends-goals.js";
import { resolveMetric } from "./metricSeries.js";
import { irelandDateStr, irelandTodayDateStr } from "./timeContext.js";
import { convertValueUnit, type UnitSystem } from "./units.js";

/**
 * What a widget will actually show, in words, for the model that is about to
 * talk about it.
 *
 * The coach never sees the rendered image - it asks for a widget and a separate
 * endpoint draws it - so without this it has nothing to describe and fills the
 * gap with invention. Asked for the rings it produced "recovery has been poor
 * to fair (the red ring)... over the last couple of weeks" for a single-day
 * card showing 68% recovery in green.
 *
 * So the tool now returns the same figures the picture is built from. The point
 * is not to be exhaustive; it is that every number the coach mentions came from
 * here rather than from a guess.
 */

type Summary = { shows: string; note?: string };

const LB_TO_KG = 0.45359237;

function toKg(value: number, unit?: string): number {
  return /^(lb|lbs|pound)/i.test(unit ?? "") ? value * LB_TO_KG : value;
}

function dayWord(iso: string): string {
  const date = irelandDateStr(new Date(iso));
  const today = irelandTodayDateStr();
  if (date === today) return "today";
  const yesterday = new Date(`${today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return date === yesterday.toISOString().slice(0, 10) ? "yesterday" : date;
}

export async function summariseWidget(metric: string, view: string): Promise<Summary> {
  const settings = (await fetchCoachingSettings()) as { unitSystem?: string; heightCm?: number; ftpWatts?: number };
  const system: UnitSystem = settings.unitSystem === "imperial" ? "imperial" : "metric";

  if (metric === "whoop.sleepRecoveryStrainRings") {
    const { history } = await fetchWhoopHistory();
    type Day = { date: string; recovery?: { score?: number } | null; strain?: { score?: number } | null; sleep?: { performancePercent?: number } | null };
    const days = (history as Day[]).slice().sort((a, b) => a.date.localeCompare(b.date));
    const newest = <K extends "recovery" | "strain" | "sleep">(key: K) => {
      for (let i = days.length - 1; i >= 0; i--) if (days[i][key]) return { value: days[i][key], date: days[i].date };
      return null;
    };
    const sleep = newest("sleep");
    const recovery = newest("recovery");
    const strain = newest("strain");
    return {
      shows:
        `Three rings for a single day, not a trend: ` +
        `sleep ${sleep?.value?.performancePercent ?? "—"}% (${sleep ? dayWord(sleep.date) : "no reading"}), ` +
        `recovery ${recovery?.value?.score ?? "—"}% (${recovery ? dayWord(recovery.date) : "no reading"}), ` +
        `strain ${strain?.value?.score ?? "—"} on Whoop's 0-21 scale (${strain ? dayWord(strain.date) : "no reading"}).`,
      note:
        "Ring colours are fixed by metric, not by how good the number is: sleep is grey-blue, strain is blue, " +
        "and only recovery is colour-banded (red under 34, amber under 67, green above). Do not describe a ring " +
        "by a colour you have not been told.",
    };
  }

  if (metric === "health.bmi") {
    const resolved = await resolveMetric("health.bmi");
    const last = resolved?.series.at(-1);
    return {
      shows: last
        ? `BMI ${last.value} for ${dayWord(last.date)}, on a band scale from 15 to 45.`
        : "No BMI - needs a weight reading and a height in Settings.",
    };
  }

  if (metric === "health.macroSplit" || metric === "health.caloriesBalance") {
    const history = await fetchHealthHistory(30);
    const dates = Object.keys(history).sort();
    const field = (day: Record<string, { value: number; unit: string }>, patterns: RegExp[]) => {
      for (const p of patterns) {
        const key = Object.keys(day ?? {}).find((n) => p.test(n));
        if (key) return day[key];
      }
      return null;
    };

    if (metric === "health.macroSplit") {
      const date = [...dates].reverse().find((d) => field(history[d], [/carbohydrate|protein|fat/i]));
      const day = history[date ?? ""] ?? {};
      const carbs = field(day, [/carbohydrate/i])?.value ?? 0;
      const fat = field(day, [/^total_fat$/i, /fat/i])?.value ?? 0;
      const protein = field(day, [/^protein$/i])?.value ?? 0;
      const kcal = carbs * 4 + fat * 9 + protein * 4;
      const pct = (grams: number, per: number) => (kcal > 0 ? Math.round(((grams * per) / kcal) * 100) : 0);
      return {
        shows: date
          ? `A donut of one day's macros (${dayWord(date)}): carbs ${Math.round(carbs)}g (${pct(carbs, 4)}% of energy), ` +
            `fat ${Math.round(fat)}g (${pct(fat, 9)}%), protein ${Math.round(protein)}g (${pct(protein, 4)}%), ` +
            `${Math.round(kcal)} kcal total. Shares are of energy, not weight.`
          : "No macros logged.",
      };
    }

    const date = [...dates].reverse().find((d) => field(history[d], [/dietary_energy|active_energy/i]));
    const day = history[date ?? ""] ?? {};
    const consumed = field(day, [/dietary_energy/i])?.value ?? null;
    const active = field(day, [/active_energy/i])?.value ?? null;
    const basal = field(day, [/basal_energy|resting_energy/i])?.value ?? null;
    const burned = active == null && basal == null ? null : (active ?? 0) + (basal ?? 0);
    return {
      shows: date
        ? `Two bars for one day (${dayWord(date)}): consumed ${consumed != null ? Math.round(consumed) : "—"} kcal, ` +
          `burned ${burned != null ? Math.round(burned) : "—"} kcal (active plus basal), ` +
          `net ${consumed != null && burned != null ? Math.round(consumed - burned) : "—"} kcal.`
        : "No energy data logged.",
    };
  }

  if (metric === "goal.weight" || metric === "goal.ftp") {
    const goals = await fetchGoals();
    if (metric === "goal.ftp") {
      const current = settings.ftpWatts ?? null;
      const target = goals.ftpTargetWatts ?? null;
      return {
        shows:
          current != null && target != null
            ? `A progress bar: FTP ${current}W now against a ${target}W target${goals.ftpTargetDate ? ` by ${goals.ftpTargetDate}` : ""}, with W/kg beside each.`
            : "No FTP goal - needs an FTP in Settings and a target.",
      };
    }
    const history = await fetchHealthHistory(120);
    const dates = Object.keys(history)
      .filter((d) => Object.keys(history[d]).some((n) => /weight|body_mass/i.test(n)))
      .sort();
    const readingOn = (d: string) => {
      const key = Object.keys(history[d]).find((n) => /weight|body_mass/i.test(n));
      return key ? history[d][key] : null;
    };
    const latest = dates.length ? readingOn(dates[dates.length - 1]) : null;
    const currentKg = latest ? toKg(latest.value, latest.unit) : null;
    const targetKg = goals.weightKg ?? null;
    const shown = (kg: number) => convertValueUnit(kg, "kg", system);
    return {
      shows:
        currentKg != null && targetKg != null
          ? `A chart of every weight reading against a straight line to the target, plus an insight table. ` +
            `Now ${Math.round(shown(currentKg).value * 10) / 10}${shown(currentKg).unit}, ` +
            `target ${Math.round(shown(targetKg).value * 10) / 10}${shown(targetKg).unit}` +
            `${goals.weightTargetDate ? ` by ${goals.weightTargetDate}` : ""}, from ${dates.length} readings.`
          : "No weight goal - needs a weight reading and a target.",
    };
  }

  if (metric === "weather.current") {
    return { shows: "Current conditions and a five-day strip for the athlete's last known location." };
  }

  if (metric === "strava.performanceChart") {
    return {
      shows:
        "CTL (fitness), ATL (fatigue) and TSB (form) plotted over the trailing four months, with this week's " +
        "ATP targets in the legend. Call get_fitness for the actual numbers before commenting on them.",
    };
  }

  const resolved = await resolveMetric(metric);
  if (!resolved) return { shows: `Nothing tracked under "${metric}".` };
  const last = resolved.series.at(-1);
  const values = resolved.series.map((p) => p.value);
  return {
    shows:
      view === "chart" || view === "timeline"
        ? `${resolved.label} over ${resolved.series.length} readings, ${Math.min(...values)}-${Math.max(...values)}${resolved.unit}, ` +
          `latest ${last?.value ?? "—"}${resolved.unit} on ${last ? dayWord(last.date) : "—"}.`
        : `${resolved.label}: ${last?.value ?? "—"}${resolved.unit} for ${last ? dayWord(last.date) : "—"}. A single figure, not a trend.`,
  };
}
