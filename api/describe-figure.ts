import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSessionEmail } from "./_lib/session.js";

/**
 * Turns a page image into searchable prose.
 *
 * Text extraction drops charts, tables and diagrams completely - in a training
 * book those often carry the actual content (a zone table, a periodisation
 * chart, a fuelling curve), so a knowledge base built from text alone quietly
 * loses the most useful pages. This describes them instead, and the description
 * is stored as text so the same lexical search finds it.
 *
 * Session-gated: it spends the athlete's Anthropic credit, one call per page.
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";

// Enough for a dense table; short enough that a figure cannot dominate the
// chunk it lands in.
const MAX_TOKENS = 700;

const PROMPT =
  "This is a page from a cycling or endurance-training book, chosen because it is mostly a figure rather than " +
  "text. Transcribe what it conveys as plain prose an athlete could search later.\n\n" +
  "If it is a table, reproduce the rows and values as text - the numbers are the point.\n" +
  "If it is a chart, state what is plotted against what, the axis ranges, and the shape or trend, including any " +
  "specific values that are labelled.\n" +
  "If it is a diagram, describe what it shows and how the parts relate.\n\n" +
  "Lead with what it is about, so a search for the topic finds it. Do not describe the page layout, the styling, " +
  "or say \"this image shows\". If the page carries no meaningful information, reply with exactly: NOTHING.";

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

  const body = req.body as { imageBase64?: string; mediaType?: string };
  if (!body.imageBase64) {
    res.status(400).json({ error: "No image given." });
    return;
  }

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
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: body.mediaType ?? "image/png", data: body.imageBase64 },
              },
              { type: "text", text: PROMPT },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      res.status(502).json({ error: `Description failed (${response.status}).` });
      return;
    }

    const data = (await response.json()) as { content?: { type: string; text?: string }[] };
    const text = (data.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("")
      .trim();

    // The model is told to say NOTHING for a blank or decorative page, so those
    // don't end up as filler in the knowledge base.
    res.status(200).json({ text: text === "NOTHING" ? "" : text });
  } catch (error) {
    console.error("describe-figure", error);
    res.status(500).json({ error: "Description failed." });
  }
}
