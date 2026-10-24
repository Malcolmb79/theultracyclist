import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSessionEmail } from "../_lib/session.js";
import { createRaceToken } from "../_lib/raceToken.js";

/**
 * Issues the key the Sauce mod uses for live commentary (see
 * api/_lib/raceToken.ts). Session-gated: only the signed-in athlete can mint
 * one, and only by asking for it on the Race page.
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  const email = getSessionEmail(req);
  if (!email) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    res.status(500).json({ error: "SESSION_SECRET is not configured." });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json(createRaceToken(email, secret));
}
