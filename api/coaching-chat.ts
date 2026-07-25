import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSessionEmail } from "./_lib/session.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";
const MAX_HISTORY = 20;

type ChatMessage = { role: "user" | "assistant"; content: string };

type ChatContext = {
  recoveryScore: number | null;
  hrvMs: number | null;
  restingHeartRate: number | null;
  strainScore: number | null;
  recentAvgStrain: number | null;
  sleepPerformance: number | null;
  weeklyDistanceKm: number | null;
  weeklyTargetKm: number | null;
  phase: "build" | "recovery" | "taper" | null;
};

function buildSystemPrompt(context: Partial<ChatContext>): string {
  const lines: string[] = [];
  if (context.recoveryScore != null) lines.push(`Recovery score: ${context.recoveryScore}%`);
  if (context.hrvMs != null) lines.push(`HRV: ${context.hrvMs} ms`);
  if (context.restingHeartRate != null) lines.push(`Resting heart rate: ${context.restingHeartRate} bpm`);
  if (context.strainScore != null) lines.push(`Yesterday's strain: ${context.strainScore}`);
  if (context.recentAvgStrain != null) lines.push(`Average strain, last 3 days: ${context.recentAvgStrain}`);
  if (context.sleepPerformance != null) lines.push(`Sleep performance: ${context.sleepPerformance}%`);
  if (context.weeklyDistanceKm != null && context.weeklyTargetKm != null) {
    lines.push(`This week's distance so far: ${context.weeklyDistanceKm}km of a ${context.weeklyTargetKm}km target`);
  }
  if (context.phase) lines.push(`Current training phase: ${context.phase}`);

  return (
    "You are a cycling coach chatting with an athlete training for an unsupported ultra-distance record " +
    "attempt (Ireland, north to south, ~570km solo). Answer their questions directly and practically, " +
    "referencing the data below where it's relevant to what they asked. Keep replies conversational and " +
    "concise - a few sentences unless they ask for real detail. Do not use markdown formatting.\n\n" +
    (lines.length ? lines.join("\n") : "No recent recovery/training data available.")
  );
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

  const body = req.body as { messages?: ChatMessage[]; context?: Partial<ChatContext> };
  const messages = (body.messages ?? [])
    .filter(
      (m): m is ChatMessage =>
        (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim().length > 0,
    )
    .slice(-MAX_HISTORY);

  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    res.status(400).json({ error: "Expected a trailing user message" });
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
        max_tokens: 400,
        system: buildSystemPrompt(body.context ?? {}),
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const data = (await response.json()) as { content: { type: string; text?: string }[] };
    const text = data.content.find((block) => block.type === "text")?.text ?? "";

    res.status(200).json({ configured: true, reply: text });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: "Unable to get a reply from the coach" });
  }
}
