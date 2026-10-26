import type { VercelRequest, VercelResponse } from "@vercel/node";
import { anthropicFailure, failureReason } from "../_lib/anthropicError.js";
import { requirePasskeySession } from "../_lib/session.js";
import { irelandTimeContext, irelandTodayDateStr } from "../_lib/timeContext.js";
import { DATA_SEMANTICS, LANGUAGE_STYLE, READING_HONESTY, garminSnapshotLines, planContext, trainingPeaksLines } from "../_lib/coachContext.js";
import { getCoachBaseline, type CoachBaseline } from "../_lib/coachBaseline.js";
import { latestGarminReadings, type GarminReadings } from "../_lib/garminReadings.js";
import { fetchTrainingPeaksData, type TrainingPeaksData } from "./trainingpeaks.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";

// What the browser posts. Recovery readings are no longer taken from it -
// Garmin's are read server-side below - only the week's progress and settings.
export type NarrativeInput = {
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

function buildPrompt(
  input: NarrativeInput,
  readings: GarminReadings,
  tp: TrainingPeaksData | null,
  baseline: CoachBaseline | null,
): string {
  const todayStr = today();
  const lines: string[] = [...garminSnapshotLines(readings, todayStr), ...trainingPeaksLines(tp, todayStr)];
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
    "ultra-distance cycling record attempt, described in the approved plan below. This note is the first thing they see when they open the chat, so before anything " +
    "else, note the time of day below and let it shape your tone.\n\n" +
    irelandTimeContext() +
    "\n\n" +
    planContext(baseline) +
    "\n\n" +
    DATA_SEMANTICS +
    "\n\n" +
    LANGUAGE_STYLE +
    "\n\n" +
    "Draw on real coaching substance: HRV- and RHR-informed readiness (a depressed HRV or elevated RHR " +
    "relative to the athlete's own baseline signals accumulated fatigue earlier and more reliably than " +
    "the readiness score alone), the balance between training load and readiness, sleep's role in adaptation, and where " +
    "today sits in the athlete's current training phase (build, recovery, or taper) - including, when " +
    "relevant, the specific demands of race-pace fueling, conservative pacing, and taper design for a " +
    "single long unsupported solo effort.\n\n" +
    "This is a greeting, not a full briefing: write just 1-2 short, concise sentences - how they should " +
    "approach today given their Garmin readiness, sleep and recent load, and what TrainingPeaks has planned for " +
    "today - if the planned session doesn't suit how recovered they are, say so - referencing the specific " +
    "numbers naturally. Check " +
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
// Keyed on the readings as well as the day. Garmin's scores sync some time
// after waking, so a note written at 06:00 is written against nothing; keyed
// by date alone that empty note would be served for the rest of the day, long
// after the numbers arrived. Body Battery is left out of the key: it moves on
// every sync, and the note states the time it was read.
let cached: { key: string; text: string } | null = null;

function cacheKey(date: string, input: NarrativeInput, readings: GarminReadings, tp: TrainingPeaksData | null): string {
  return [
    date,
    readings.readiness,
    readings.readinessDate,
    readings.hrvMs,
    readings.restingHeartRate,
    readings.sleepScore,
    readings.sleepDate,
    input.hasRiddenToday,
    tp?.workouts.filter((w) => w.date === date).map((w) => `${w.title}:${w.completed}`).join(",") ?? "",
  ].join("|");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Coaching is passkey-gated, unlike the rest of the dashboard - see
  // requirePasskeySession. It answers on failure, including the code the
  // client needs to offer a passkey prompt rather than a sign-in page.
  if (!requirePasskeySession(req, res)) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(200).json({ configured: false });
    return;
  }

  const date = today();
  // Garmin's readings are read here rather than taken from the browser, so
  // every channel quotes the same numbers.
  const input = req.body as NarrativeInput;
  const [readings, tp, baseline] = await Promise.all([
    latestGarminReadings(),
    fetchTrainingPeaksData().catch(() => null),
    getCoachBaseline(),
  ]);
  const key = `${cacheKey(date, input, readings, tp)}|${baseline?.updatedAt ?? ""}`;
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
        messages: [{ role: "user", content: buildPrompt(input, readings, tp, baseline) }],
      }),
    });

    if (!response.ok) {
      throw await anthropicFailure(response);
    }

    const data = (await response.json()) as { content: { type: string; text?: string }[] };
    const text = data.content.find((block) => block.type === "text")?.text ?? "";

    cached = { key, text };
    res.status(200).json({ configured: true, text, cached: false });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: "Unable to generate coaching note", reason: failureReason(error) });
  }
}
