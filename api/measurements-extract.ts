import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSessionEmail } from "./_lib/session.js";

/**
 * Reads measurements off a screenshot and hands them back for approval.
 *
 * Writes nothing. That separation is the whole point: a vision model reading
 * digits off a phone screenshot will occasionally return 137 for 187, and a
 * wrong resting heart rate that lands silently in the database is worse than
 * no reading at all, because the coach then reasons from it. Saving happens
 * in api/measurements.ts, from rows the athlete has looked at.
 *
 * Session-gated - it spends the athlete's Anthropic credit per upload.
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 1500;

// A phone screenshot resized client-side lands well under this; the cap is
// the backstop against a caller that skips the resize.
const MAX_IMAGE_CHARS = 5_000_000;

const SYSTEM =
  "You read measurements off screenshots of health, fitness and medical apps, and report them as structured data. " +
  "You are precise about digits and you never invent a value that is not visible.";

const PROMPT = `Read every measurement shown in this screenshot.

For each one report:
- metric: a short snake_case key, lowercase. Use the standard name where one exists: resting_heart_rate, hrv, vo2max, body_fat, weight, sleep_duration, ferritin, haemoglobin. Otherwise derive it from the label on screen.
- label: the wording on screen, kept as it appears.
- value: the number only. If a value is a duration like 7h 32m, convert to the unit you report and say which.
- unit: as shown (bpm, ms, %, kg, ng/mL, hours). Null if genuinely unitless.
- measuredOn: the date the reading is about, YYYY-MM-DD, if the screenshot shows one. Null if it does not. Do not guess a date from context.
- confidence: "high" if the number and its label are both unambiguous, "low" if the digits are small, cropped, overlapping, or you are inferring what the label means.

Also report the app the screenshot came from, if its name or interface is recognisable.

Rules:
- Report only what is visible. Never estimate, average, or fill a gap.
- Skip chart axes, targets, goals and comparisons against other people. Those are not readings.
- Where a screen shows both a current value and a trend or range, report only the current value.
- If a number is partly cut off, either omit it or mark it low confidence. Do not complete it.
- If the image contains no measurements at all, return an empty list.`;

type ExtractedRow = {
  metric: string;
  label: string;
  value: number;
  unit: string | null;
  measuredOn: string | null;
  confidence: "high" | "low";
};

const TOOL = {
  name: "report_measurements",
  description: "Report the measurements visible in the screenshot.",
  input_schema: {
    type: "object" as const,
    properties: {
      source: {
        type: "string",
        description: "The app the screenshot is from, e.g. Oura, InBody, Zwift. Empty string if not identifiable.",
      },
      measurements: {
        type: "array",
        items: {
          type: "object",
          properties: {
            metric: { type: "string" },
            label: { type: "string" },
            value: { type: "number" },
            unit: { type: ["string", "null"] },
            measuredOn: { type: ["string", "null"] },
            confidence: { type: "string", enum: ["high", "low"] },
          },
          required: ["metric", "label", "value", "confidence"],
        },
      },
    },
    required: ["source", "measurements"],
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!getSessionEmail(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured." });
    return;
  }

  const body = (req.body ?? {}) as { imageBase64?: string; mediaType?: string };
  if (!body.imageBase64) {
    res.status(400).json({ error: "No image given." });
    return;
  }
  if (body.imageBase64.length > MAX_IMAGE_CHARS) {
    res.status(413).json({ error: "That screenshot is too large - try a smaller one." });
    return;
  }

  const mediaType = body.mediaType ?? "image/jpeg";

  try {
    const response = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM,
        tools: [TOOL],
        // Forced rather than optional: the caller needs rows or an empty
        // list, and prose it then has to parse is how this becomes flaky.
        tool_choice: { type: "tool", name: "report_measurements" },
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: body.imageBase64 } },
              { type: "text", text: PROMPT },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error("measurements-extract: Anthropic error", response.status, detail.slice(0, 500));
      res.status(502).json({ error: "Could not read that screenshot. Try again in a moment." });
      return;
    }

    const data = (await response.json()) as {
      content?: { type: string; name?: string; input?: { source?: string; measurements?: ExtractedRow[] } }[];
    };
    const toolUse = data.content?.find((c) => c.type === "tool_use" && c.name === "report_measurements");
    const input = toolUse?.input;

    const rows = Array.isArray(input?.measurements) ? input.measurements : [];
    // Validated here rather than trusted: the schema constrains shape, not
    // sense, and a NaN reaching the review table would save as a NaN.
    const clean = rows
      .filter((r) => r && typeof r.metric === "string" && Number.isFinite(r.value))
      .map((r) => ({
        metric: r.metric.trim().toLowerCase().replace(/\s+/g, "_").slice(0, 64),
        label: (r.label ?? r.metric).trim().slice(0, 120),
        value: r.value,
        unit: r.unit ? String(r.unit).trim().slice(0, 24) : null,
        measuredOn: /^\d{4}-\d{2}-\d{2}$/.test(r.measuredOn ?? "") ? r.measuredOn : null,
        confidence: r.confidence === "low" ? ("low" as const) : ("high" as const),
      }));

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ source: (input?.source ?? "").trim().slice(0, 60), measurements: clean });
  } catch (error) {
    console.error("measurements-extract", error);
    res.status(500).json({ error: "Could not read that screenshot." });
  }
}
