import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyRaceCors, getRaceAuthEmail } from "../_lib/raceToken.js";

/**
 * Speaks a line of race commentary with OpenAI's text-to-speech, for a far
 * more natural voice than the browser's own.
 *
 * Takes the line the commentary route just wrote and returns MP3 audio. The
 * model is steerable, so it's told how a TV cycling commentator sounds
 * rather than just which voice to use. Gated like the commentary itself
 * (session cookie on the site, race key from the mod) since it spends the
 * athlete's OpenAI credit.
 *
 * Needs OPENAI_API_KEY in the environment. Without it this answers 503 and
 * the console falls back to the browser's voice.
 */

const OPENAI_URL = "https://api.openai.com/v1/audio/speech";
// Overridable so a newer model can be tried without a deploy.
const MODEL = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const DEFAULT_VOICE = process.env.OPENAI_TTS_VOICE || "ash";
const VOICES = ["ash", "ballad", "cedar", "coral", "echo", "fable", "marin", "onyx", "nova", "sage", "shimmer", "verse", "alloy"];
/** A commentary line is ~45 words; this leaves room without inviting essays. */
const MAX_TEXT_CHARS = 600;

const COMMENTARY_INSTRUCTIONS = [
  "Voice: a seasoned British cycling commentator, live on TV, in the commentary box.",
  "Tone: warm, conversational and genuinely into the race, like chatting to friends watching along.",
  "Delivery: animated and expressive. Lift the energy and pace for big moments and exclamation marks, settle down when it's calm.",
  "Pacing: natural broadcast rhythm, brief pauses at commas and full stops, never rushed or monotone.",
].join(" ");

/** The tactics coach sounds like race radio, not a broadcast. */
const TACTICS_INSTRUCTIONS = [
  "Voice: a calm, experienced British cycling coach speaking to their rider over race radio.",
  "Tone: focused, direct and encouraging. Clear and close, like talking right into an earpiece.",
  "Delivery: brisk and decisive. Urgent and punchy when it's time to act, steady and reassuring otherwise.",
  "Pacing: short, clipped phrases with natural pauses. Never theatrical.",
].join(" ");

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyRaceCors(req, (name, value) => res.setHeader(name, value));
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (!getRaceAuthEmail(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "OPENAI_API_KEY is not configured.", code: "not-configured" });
    return;
  }

  const body = req.body as { text?: unknown; voice?: unknown; mode?: unknown };
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text || text.length > MAX_TEXT_CHARS) {
    res.status(400).json({ error: "No line to speak, or too long." });
    return;
  }
  const voice = typeof body.voice === "string" && VOICES.includes(body.voice) ? body.voice : DEFAULT_VOICE;

  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: MODEL, voice, input: text, instructions: body.mode === "tactics" ? TACTICS_INSTRUCTIONS : COMMENTARY_INSTRUCTIONS, response_format: "mp3" }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error("race-voice", response.status, detail);
      // OpenAI's own reason (no credit, bad key, unknown voice) is what the
      // athlete needs to fix it, so it goes back rather than a bare status.
      let reason = "";
      try {
        reason = (JSON.parse(detail) as { error?: { message?: string } }).error?.message ?? "";
      } catch {
        // Not JSON - the status alone will have to do.
      }
      res.status(502).json({
        error: `OpenAI refused the voice request (${response.status})${reason ? `: ${reason.slice(0, 300)}` : "."}`,
      });
      return;
    }
    const audio = Buffer.from(await response.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(audio);
  } catch (error) {
    console.error("race-voice", error);
    res.status(500).json({ error: "Voice failed." });
  }
}
