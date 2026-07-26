import type { VercelRequest, VercelResponse } from "@vercel/node";
import twilio from "twilio";
import { getJSON, setJSON } from "./_lib/kvStore.js";
import { generateCoachReply, type ChatMessage } from "./coaching-chat.js";
import { computeChatContext } from "./_lib/coachSnapshot.js";

const MAX_HISTORY = 20; // matches the browser chat's own cap in coaching-chat.ts

// Per-sender conversation history, so a WhatsApp thread can hold a real
// back-and-forth (the model sees prior turns) rather than treating every
// inbound text as a one-off with no memory of what was just said. Keyed by
// the sender's WhatsApp number rather than a single shared key, in case
// more than one number is ever allow-listed.
function historyKey(fromNumber: string): string {
  return `WHATSAPP_HISTORY_${fromNumber}`;
}

// Only numbers in this allow-list get a reply - same allow-list-by-env-var
// pattern as ALLOWED_M365_EMAILS in _lib/session.ts. Twilio's WhatsApp
// sandbox is only reachable by whoever has texted your specific join code,
// but this is defense in depth against that sandbox being shared/guessed,
// and is the only gate at all once this moves off the sandbox to a real
// number.
function isAllowedNumber(fromNumber: string): boolean {
  const allowlist = (process.env.COACH_WHATSAPP_ALLOWED_NUMBERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allowlist.includes(fromNumber);
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function twiml(message?: string): string {
  const body = message ? `<Message>${escapeXml(message)}</Message>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
}

function sendTwiml(res: VercelResponse, message?: string) {
  res.setHeader("Content-Type", "text/xml");
  res.status(200).send(twiml(message));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken || !process.env.ANTHROPIC_API_KEY) {
    // Not configured yet - degrade quietly rather than erroring, same
    // "missing config" pattern as every other integration in this app.
    sendTwiml(res);
    return;
  }

  const params = (req.body ?? {}) as Record<string, string>;
  const signature = req.headers["x-twilio-signature"];
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "https";
  const url = `${proto}://${req.headers.host}${req.url}`;

  if (typeof signature !== "string" || !twilio.validateRequest(authToken, signature, url, params)) {
    res.status(403).send("Invalid signature");
    return;
  }

  const fromRaw = params.From ?? "";
  const fromNumber = fromRaw.replace(/^whatsapp:/, "").trim();
  const messageBody = (params.Body ?? "").trim();

  if (!fromNumber || !messageBody || !isAllowedNumber(fromNumber)) {
    // Silently ignore rather than replying "not authorized" - no reason to
    // confirm to a stranger that this number even does anything.
    sendTwiml(res);
    return;
  }

  try {
    const key = historyKey(fromNumber);
    const history = (await getJSON<ChatMessage[]>(key)) ?? [];
    const messages: ChatMessage[] = [...history, { role: "user", content: messageBody }].slice(-MAX_HISTORY);

    const context = await computeChatContext();
    const reply = await generateCoachReply(messages, context);

    const nextHistory = [...messages, { role: "assistant" as const, content: reply }].slice(-MAX_HISTORY);
    await setJSON(key, nextHistory);

    sendTwiml(res, reply);
  } catch (error) {
    console.error(error);
    sendTwiml(res, "Sorry, I couldn't pull that together just now - try again in a bit.");
  }
}
