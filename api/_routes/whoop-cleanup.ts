import type { VercelRequest, VercelResponse } from "@vercel/node";
import { deleteKeys, readJSON, setJSON } from "../_lib/kvStore.js";

// One-off: rewrites saved layouts that still name Whoop widgets to their
// Garmin replacements and deletes Whoop's stored tokens and cache, so the
// Whoop compatibility code can go. Removed once it has run.

const IDS: Record<string, string> = {
  "whoop.recovery": "garmin.readiness",
  "whoop.hrv": "garmin.hrv",
  "whoop.restingHr": "garmin.restingHr",
  "whoop.strain": "garmin.trainingLoad",
  "whoop.sleepPerformance": "garmin.sleepScore",
  "whoop.sleepHours": "garmin.sleepHours",
  "whoop.strainRecoveryCombo": "garmin.loadReadinessCombo",
  "whoop.sleepRecoveryStrainRings": "garmin.sleepReadinessBatteryRings",
  "whoop.healthCalendar": "garmin.healthCalendar",
  "whoop.bodyBattery": "garmin.bodyBattery",
};
const RETIRED = new Set(["whoop.strainAvgHr"]);
const LABELS: Record<string, string> = {
  "Recovery score": "Training Readiness",
  Recovery: "Training Readiness",
  Strain: "Training load",
  "Sleep performance": "Sleep score",
  "Strain & Recovery": "Training Load & Readiness",
  "Sleep, Recovery & Strain": "Sleep, Readiness, Body Battery & Load",
};

let changes = 0;

function migrate(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .filter((item) => {
        const retired = typeof (item as { metric?: unknown })?.metric === "string" && RETIRED.has((item as { metric: string }).metric);
        if (retired) changes++;
        return !retired;
      })
      .map(migrate);
  }
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = migrate(v);
  const metric = out.metric;
  if (typeof metric === "string" && IDS[metric]) {
    out.metric = IDS[metric];
    if (typeof out.label === "string") out.label = LABELS[out.label] ?? out.label;
    changes++;
  }
  if (out.source === "whoop") {
    out.source = "garmin";
    changes++;
  }
  return out;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.APPLE_HEALTH_WEBHOOK_SECRET;
  if (req.method !== "POST" || !secret || req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const dryRun = req.query.dryRun === "1";
  const layouts: Record<string, number> = {};
  for (const key of ["DASHBOARD_LAYOUT", "TRENDS_LAYOUT", "COACHING_SETTINGS"]) {
    changes = 0;
    const stored = await readJSON<unknown>(key);
    if (stored == null) continue;
    const next = migrate(stored);
    layouts[key] = changes;
    if (changes > 0 && !dryRun && !(await setJSON(key, next))) {
      res.status(503).json({ error: `Could not write ${key}`, layouts });
      return;
    }
  }
  const whoopKeys = ["WHOOP_REFRESH_TOKEN", "WHOOP_ACCESS_TOKEN", "WHOOP_HISTORY_CACHE"];
  const deleted = dryRun ? 0 : await deleteKeys(whoopKeys);
  res.status(200).json({ dryRun, layouts, deletedWhoopKeys: deleted });
}
