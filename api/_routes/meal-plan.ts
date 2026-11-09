import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getJSON, setJSON } from "../_lib/kvStore.js";
import { getSessionEmail } from "../_lib/session.js";

/**
 * The week's meal choices and the shopping list's ticks, for the Meals page
 * (the plan itself is src/data/mealPlan.ts). Kept in Redis so they're the
 * same on the phone at the shops as on the computer that planned them.
 *
 * GET answers { week }; POST { week } saves it. Signed in on the site only.
 */

const KEY = "meal-plan:week";
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const MAX_BYTES = 20_000;

interface Week {
  /** Day -> category -> meal id (or null for none). */
  days: Record<string, Record<string, string | null>>;
  /** Shopping list items ticked off. */
  checked: string[];
  /** When the week was started, YYYY-MM-DD. */
  startedOn?: string;
  /** The plan the week follows, and any day following another. */
  plan?: string;
  dayPlan?: Record<string, string>;
  /** Training days (post-workout snack) and fasting days (no breakfast), where set. */
  training?: Record<string, boolean>;
  fast?: Record<string, boolean>;
  /** Each person's training and fasting days, where set. */
  trainingBy?: Record<string, Record<string, boolean>>;
  fastBy?: Record<string, Record<string, boolean>>;
  /** Who's eating each day: both, or just one of them. */
  who?: Record<string, "both" | "malcolm" | "lizette">;
  /** Malcolm's kcal on training days, if not his plan's own (0 for the plan's) - kept for older weeks. */
  trainingKcal?: number;
  /** Each person's day totals, kcal, on rest days and on training days, where chosen. */
  kcal?: Record<string, { rest?: number; training?: number }>;
}

const isId = (x: unknown): x is string => typeof x === "string" && /^[a-z0-9-]{1,40}$/.test(x);

function perDay<T>(input: unknown, ok: (v: unknown) => v is T): Record<string, T> {
  const out: Record<string, T> = {};
  if (!input || typeof input !== "object") return out;
  for (const d of DAYS) {
    const v = (input as Record<string, unknown>)[d];
    if (ok(v)) out[d] = v;
  }
  return out;
}

/** A per-day yes/no for each person. */
function perPerson(input: unknown): Record<string, Record<string, boolean>> {
  const out: Record<string, Record<string, boolean>> = {};
  if (!input || typeof input !== "object") return out;
  const isBool = (v: unknown): v is boolean => typeof v === "boolean";
  for (const person of ["malcolm", "lizette"]) out[person] = perDay((input as Record<string, unknown>)[person], isBool);
  return out;
}

function cleanKcal(input: unknown): Week["kcal"] {
  const out: NonNullable<Week["kcal"]> = {};
  if (!input || typeof input !== "object") return undefined;
  const ok = (v: unknown): v is number => typeof v === "number" && v >= 800 && v <= 5000;
  for (const person of ["malcolm", "lizette"]) {
    const k = (input as Record<string, unknown>)[person] as { rest?: unknown; training?: unknown } | undefined;
    if (!k || typeof k !== "object") continue;
    out[person] = { rest: ok(k.rest) ? Math.round(k.rest) : undefined, training: ok(k.training) ? Math.round(k.training) : undefined };
  }
  return out;
}

function clean(input: unknown): Week | null {
  if (!input || typeof input !== "object") return null;
  const w = input as Partial<Week>;
  const days: Week["days"] = {};
  for (const d of DAYS) {
    const day = (w.days as Record<string, unknown> | undefined)?.[d];
    if (!day || typeof day !== "object") continue;
    days[d] = {};
    for (const [cat, id] of Object.entries(day as Record<string, unknown>)) {
      if (typeof cat === "string" && cat.length < 30 && (id === null || (typeof id === "string" && id.length < 80))) days[d][cat] = id as string | null;
    }
  }
  const checked = Array.isArray(w.checked) ? w.checked.filter((x): x is string => typeof x === "string" && x.length < 120).slice(0, 300) : [];
  const startedOn = typeof w.startedOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(w.startedOn) ? w.startedOn : undefined;
  const isBool = (v: unknown): v is boolean => typeof v === "boolean";
  return {
    days,
    checked,
    startedOn,
    plan: isId(w.plan) ? w.plan : undefined,
    dayPlan: perDay(w.dayPlan, isId),
    training: perDay(w.training, isBool),
    fast: perDay(w.fast, isBool),
    trainingBy: perPerson(w.trainingBy),
    fastBy: perPerson(w.fastBy),
    trainingKcal: typeof w.trainingKcal === "number" && (w.trainingKcal === 0 || (w.trainingKcal >= 1200 && w.trainingKcal <= 4000)) ? Math.round(w.trainingKcal) : undefined,
    kcal: cleanKcal(w.kcal),
    who: perDay(w.who, (v): v is "both" | "malcolm" | "lizette" => v === "both" || v === "malcolm" || v === "lizette"),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!getSessionEmail(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET") {
    res.status(200).json({ week: (await getJSON<Week>(KEY)) ?? { days: {}, checked: [] } });
    return;
  }
  if (req.method === "POST") {
    if (JSON.stringify(req.body ?? {}).length > MAX_BYTES) {
      res.status(413).json({ error: "Too large." });
      return;
    }
    const week = clean((req.body as { week?: unknown } | undefined)?.week);
    if (!week) {
      res.status(400).json({ error: "No week given." });
      return;
    }
    await setJSON(KEY, week);
    res.status(200).json({ week });
    return;
  }
  res.status(405).json({ error: "Method not allowed" });
}
