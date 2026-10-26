import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSessionEmail } from "../_lib/session.js";

// Which deployment is answering, and whether it can see the API keys the
// AI features need - for when a key has been added in Vercel but a feature
// still says it's missing. Only ever says whether a key is there, how long
// it is and how it starts (enough to tell it's the right kind of key),
// never the key itself. Signed-in only.

function describe(name: string, prefix: string) {
  const value = process.env[name];
  if (value == null) return { present: false };
  const trimmed = value.trim();
  return {
    present: trimmed.length > 0,
    length: value.length,
    // Spaces or line breaks pasted in with the key break it.
    hasSurroundingWhitespace: trimmed.length !== value.length,
    startsLike: trimmed.slice(0, Math.min(prefix.length, trimmed.length)),
    looksRight: trimmed.startsWith(prefix),
  };
}

/**
 * One single-token request to Claude with the coaching model, so a key that
 * is there but refused (no credit, revoked, wrong account) says why.
 */
async function testAnthropic() {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { ran: false };
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1, messages: [{ role: "user", content: "ok" }] }),
    });
    if (response.ok) return { ran: true, works: true };
    const body = (await response.json().catch(() => ({}))) as { error?: { type?: string; message?: string } };
    return { ran: true, works: false, status: response.status, type: body.error?.type, message: body.error?.message };
  } catch (e) {
    return { ran: true, works: false, message: e instanceof Error ? e.message : "Request failed" };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!getSessionEmail(req)) {
    res.status(401).json({ error: "Sign in to theultracyclist.com first, then open this page again." });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    deployment: {
      environment: process.env.VERCEL_ENV ?? null,
      url: process.env.VERCEL_URL ?? null,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      commitMessage: process.env.VERCEL_GIT_COMMIT_MESSAGE?.split("\n")[0] ?? null,
      project: process.env.VERCEL_PROJECT_PRODUCTION_URL ?? null,
    },
    anthropicTest: await testAnthropic(),
    keys: {
      ANTHROPIC_API_KEY: describe("ANTHROPIC_API_KEY", "sk-ant-"),
      OPENAI_API_KEY: describe("OPENAI_API_KEY", "sk-"),
      // The Zwift login ZwiftPower is read with: only whether it's there.
      ZWIFT_USERNAME: { present: !!process.env.ZWIFT_USERNAME?.trim() },
      ZWIFT_PASSWORD: { present: !!process.env.ZWIFT_PASSWORD },
    },
  });
}
