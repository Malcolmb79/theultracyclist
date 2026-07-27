import type { VercelRequest, VercelResponse } from "@vercel/node";
import twilio from "twilio";
import { getSessionEmail } from "./_lib/session.js";

// Sends the Coaching page's assembled weekly check-in text out as an
// outbound WhatsApp message via Twilio's REST client - a different call
// shape from api/whatsapp-webhook.ts, which only ever replies to an
// inbound message via TwiML and never initiates one. Outbound sending
// needs the account SID (not just the auth token) and an explicit
// recipient, since there's no inbound request to reply to.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!getSessionEmail(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { text } = (req.body ?? {}) as { text?: string };
  if (!text || typeof text !== "string") {
    res.status(400).json({ error: "Missing text" });
    return;
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  const to = process.env.CHECKIN_RECIPIENT_NUMBER;

  if (!accountSid || !authToken || !from || !to) {
    // Missing config degrades gracefully, same pattern as every other
    // integration in this app - the client falls back to showing the text
    // for the owner to copy/send themselves rather than erroring.
    res.status(200).json({ sent: false, reason: "not_configured" });
    return;
  }

  try {
    const client = twilio(accountSid, authToken);
    await client.messages.create({ from, to, body: text });
    res.status(200).json({ sent: true });
  } catch (error) {
    console.error(error);
    res.status(200).json({ sent: false, reason: "send_failed" });
  }
}
