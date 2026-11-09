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
  return { days, checked, startedOn };
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
