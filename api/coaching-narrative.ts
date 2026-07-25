import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSessionEmail } from "./_lib/session.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";

export type NarrativeInput = {
  recoveryScore: number | null;
  hrvMs: number | null;
  restingHeartRate: number | null;
  strainScore: number | null;
  recentAvgStrain: number | null;
  sleepPerformance: number | null;
  weeklyDistanceKm: number | null;
  weeklyTargetKm: number | null;
  phase: "build" | "recovery" | "taper" | null;
  customRules: string | null;
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildPrompt(input: NarrativeInput): string {
  const lines: string[] = [];
  if (input.recoveryScore != null) lines.push(`Recovery score: ${input.recoveryScore}%`);
  if (input.hrvMs != null) lines.push(`HRV: ${input.hrvMs} ms`);
  if (input.restingHeartRate != null) lines.push(`Resting heart rate: ${input.restingHeartRate} bpm`);
  if (input.strainScore != null) lines.push(`Yesterday's strain: ${input.strainScore}`);
  if (input.recentAvgStrain != null) lines.push(`Average strain, last 3 days: ${input.recentAvgStrain}`);
  if (input.sleepPerformance != null) lines.push(`Sleep performance: ${input.sleepPerformance}%`);
  if (input.weeklyDistanceKm != null && input.weeklyTargetKm != null) {
    lines.push(`This week's distance so far: ${input.weeklyDistanceKm}km of a ${input.weeklyTargetKm}km target`);
  }
  if (input.phase) lines.push(`Current training phase: ${input.phase}`);

  return (
    "You are an experienced cycling coach writing a short daily note for an athlete preparing for an " +
    "unsupported ultra-distance record attempt (Ireland, north to south, roughly 570km solo, one continuous " +
    "unsupported effort). Draw on real coaching substance: HRV- and RHR-informed readiness (a depressed HRV " +
    "or elevated RHR relative to the athlete's own baseline signals accumulated fatigue earlier and more " +
    "reliably than recovery score alone), the balance between strain and recovery over the last few days, " +
    "sleep's role in adaptation, and where today sits in the athlete's current training phase (build, " +
    "recovery, or taper) - including, when relevant, the specific demands of race-pace fueling, conservative " +
    "pacing, and taper design for a multi-day unsupported solo effort.\n\n" +
    "Based on the data below, write a 2-4 sentence coaching note: how they should approach today's training " +
    "given their recovery and recent load, referencing the specific numbers naturally. Be direct and " +
    "practical, not generic motivational filler. Do not use markdown formatting.\n\n" +
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
let cached: { date: string; text: string } | null = null;

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
  if (cached && cached.date === date) {
    res.status(200).json({ configured: true, text: cached.text, cached: true });
    return;
  }

  try {
    const input = req.body as NarrativeInput;
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

    cached = { date, text };
    res.status(200).json({ configured: true, text, cached: false });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: "Unable to generate coaching note" });
  }
}
