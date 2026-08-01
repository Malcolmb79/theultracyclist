import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSessionEmail } from "./_lib/session.js";
import { latestWhoopReadings } from "./_lib/coachSnapshot.js";
import { irelandTimeContext, irelandTodayDateStr } from "./_lib/timeContext.js";
import { ATHLETE_PROFILE, DATA_SEMANTICS, SEASON_PLAN, LANGUAGE_STYLE, READING_HONESTY, readingLine } from "./_lib/coachContext.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";

export type NarrativeInput = {
  recoveryScore: number | null;
  hrvMs: number | null;
  restingHeartRate: number | null;
  strainScore: number | null;
  /**
   * The day each reading belongs to (YYYY-MM-DD, Irish). Recovery, HRV and RHR
   * share one - they are scored together each morning - while sleep and strain
   * can lag or lead it independently, so each carries its own. Sent even when
   * it is today's: the coach is told to name the day whenever it isn't, and it
   * cannot do that without knowing which day it has.
   */
  recoveryDate: string | null;
  sleepDate: string | null;
  strainDate: string | null;
  recentAvgStrain: number | null;
  sleepPerformance: number | null;
  weeklyDistanceKm: number | null;
  weeklyTargetKm: number | null;
  phase: "build" | "recovery" | "taper" | null;
  customRules: string | null;
  hasRiddenToday: boolean;
  todayDistanceKm: number | null;
};

// The Irish calendar day, not the server's UTC one - a narrative generated
// just after Irish midnight during BST was dated, and cached under, the
// previous day.
function today(): string {
  return irelandTodayDateStr();
}

function buildPrompt(input: NarrativeInput): string {
  const todayStr = today();
  const lines: string[] = [];
  lines.push(readingLine("Recovery score", input.recoveryScore, input.recoveryDate, "%", todayStr));
  lines.push(readingLine("HRV", input.hrvMs, input.recoveryDate, " ms", todayStr));
  lines.push(readingLine("Resting heart rate", input.restingHeartRate, input.recoveryDate, " bpm", todayStr));
  // Strain is the one live figure here: it climbs all day and is read fresh on
  // every request, so it is the current total, not a settled score.
  lines.push(
    input.strainScore == null
      ? "Strain: no reading on record"
      : input.strainDate === todayStr
        ? `Strain so far today: ${input.strainScore} - LIVE, read just now, still rising as the day goes on`
        : readingLine("Strain", input.strainScore, input.strainDate, "", todayStr),
  );
  if (input.recentAvgStrain != null) lines.push(`Average strain, last 3 days: ${input.recentAvgStrain}`);
  lines.push(readingLine("Sleep performance", input.sleepPerformance, input.sleepDate, "%", todayStr));
  if (input.weeklyDistanceKm != null && input.weeklyTargetKm != null) {
    lines.push(`This week's distance so far: ${input.weeklyDistanceKm}km of a ${input.weeklyTargetKm}km target`);
  }
  if (input.phase) lines.push(`Current training phase: ${input.phase}`);
  lines.push(
    input.hasRiddenToday
      ? `Already completed a ride today: ${input.todayDistanceKm}km`
      : "No ride logged yet today",
  );

  return (
    "You are a professional cycling coach writing a short daily note for an athlete preparing for an " +
    "unsupported ultra-distance record attempt (Ireland, north to south, roughly 570km solo, one continuous " +
    "unsupported effort). This note is the first thing they see when they open the chat, so before anything " +
    "else, note the time of day below and let it shape your tone.\n\n" +
    irelandTimeContext() +
    "\n\n" +
    ATHLETE_PROFILE +
    "\n\n" +
    DATA_SEMANTICS +
    "\n\n" +
    SEASON_PLAN +
    "\n\n" +
    LANGUAGE_STYLE +
    "\n\n" +
    "Draw on real coaching substance: HRV- and RHR-informed readiness (a depressed HRV or elevated RHR " +
    "relative to the athlete's own baseline signals accumulated fatigue earlier and more reliably than " +
    "recovery score alone), the balance between strain and recovery, sleep's role in adaptation, and where " +
    "today sits in the athlete's current training phase (build, recovery, or taper) - including, when " +
    "relevant, the specific demands of race-pace fueling, conservative pacing, and taper design for a " +
    "multi-day unsupported solo effort.\n\n" +
    "This is a greeting, not a full briefing: write just 1-2 short, concise sentences - how they should " +
    "approach today given their recovery and recent load, referencing the specific numbers naturally. Check " +
    "whether they've already ridden today (below) before writing anything about today's session - if they " +
    "have, don't ask what's on the schedule or suggest they still need to train today; instead speak to " +
    "recovery from that ride and what it means for tomorrow. Be direct and practical, not generic " +
    "motivational filler. Do not use markdown formatting.\n\n" +
    READING_HONESTY +
    "\n\n" +
    (input.customRules
      ? `The athlete has set these standing rules - always follow them, even over generic best practice:\n${input.customRules}\n\n`
      : "") +
    lines.join("\n")
  );
}

// Cached in memory only (not persisted to Vercel) - this is disposable,
// regenerable data, not user data, so it doesn't need the durability (and
// deploy-hook overhead) that saved layouts/goals need. Worst case a cold
// start regenerates it once; there's no data-loss risk either way.
//
// Keyed on the readings as well as the day. Whoop scores land some time after
// waking, so a note written at 06:00 is written against nothing; keyed by date
// alone that empty note would be served for the rest of the day, long after
// the numbers arrived.
let cached: { key: string; text: string } | null = null;

function cacheKey(date: string, input: NarrativeInput): string {
  return [
    date,
    input.recoveryScore,
    input.recoveryDate,
    input.hrvMs,
    input.restingHeartRate,
    input.sleepPerformance,
    input.sleepDate,
    input.hasRiddenToday,
  ].join("|");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!getSessionEmail(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(200).json({ configured: false });
    return;
  }

  const date = today();
  // Read Whoop server-side rather than trusting the snapshot the browser
  // posted. The browser's came from /api/whoop-data behind an edge cache, so
  // it can be up to a quarter of an hour behind the watch - and a note that
  // opens with this morning's recovery has to be looking at this morning's
  // recovery. Only the Whoop readings are re-read: everything else in the
  // note (weekly distance, phase, rules) the browser already has right, and
  // fetching the whole coach snapshot here made the card stop loading.
  const posted = req.body as NarrativeInput;
  const live = await latestWhoopReadings().catch(() => ({}));
  const input: NarrativeInput = { ...posted };
  for (const [field, value] of Object.entries(live)) {
    if (value != null) (input as Record<string, unknown>)[field] = value;
  }
  const key = cacheKey(date, input);
  if (cached && cached.key === key) {
    res.status(200).json({ configured: true, text: cached.text, cached: true });
    return;
  }

  try {
    const response = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        messages: [{ role: "user", content: buildPrompt(input) }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const data = (await response.json()) as { content: { type: string; text?: string }[] };
    const text = data.content.find((block) => block.type === "text")?.text ?? "";

    cached = { key, text };
    res.status(200).json({ configured: true, text, cached: false });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: "Unable to generate coaching note" });
  }
}
