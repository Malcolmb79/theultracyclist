import { createHmac, timingSafeEqual } from "node:crypto";
import type { VercelRequest } from "@vercel/node";
import { getSessionEmail } from "./session.js";

/**
 * A key for the Sauce for Zwift mod, which runs the Race console from
 * http://localhost:1080 and so never sees the site's session cookie.
 *
 * The signed-in Race page issues it (api/_routes/race-token.ts) and the
 * athlete pastes it into the mod once. It only opens the race routes: it is
 * signed for its own purpose, so it can't be replayed as a session cookie,
 * and a session cookie can't be passed off as one. Rotating SESSION_SECRET
 * revokes every key along with every session.
 *
 * Long-lived because it sits in the mod on the Zwift PC; asking for a fresh
 * one before every race would be the friction that gets it shared around
 * instead.
 */
const PURPOSE = "race-commentary";
const TTL_MS = 90 * 24 * 60 * 60 * 1000;

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(`${PURPOSE}:${payload}`).digest("base64url");
}

export function createRaceToken(email: string, secret: string, now = Date.now()): { token: string; expiresAt: number } {
  const expiresAt = now + TTL_MS;
  const payload = Buffer.from(JSON.stringify({ email, purpose: PURPOSE, exp: expiresAt })).toString("base64url");
  return { token: `${payload}.${sign(payload, secret)}`, expiresAt };
}

function verifyRaceToken(token: string, secret: string): string | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(sign(payload, secret));
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      email?: string;
      purpose?: string;
      exp?: number;
    };
    if (data.purpose !== PURPOSE || !data.email || typeof data.exp !== "number" || data.exp < Date.now()) return null;
    return data.email;
  } catch {
    return null;
  }
}

/** The signed-in athlete, from the session cookie (site) or a race key (mod). */
export function getRaceAuthEmail(req: VercelRequest): string | null {
  const fromSession = getSessionEmail(req);
  if (fromSession) return fromSession;
  const secret = process.env.SESSION_SECRET;
  const offered = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || !offered) return null;
  return verifyRaceToken(offered, secret);
}

/**
 * CORS for the mod. Only the places Sauce serves mod pages from are let in:
 * this machine's loopback address in a browser, and file:// pages (origin
 * "file://" or "null"), which is how Sauce's own windows load them. The routes behind it need a
 * bearer key and no cookies cross over, so this opens nothing another page
 * could ride on without the key.
 */
export function applyRaceCors(req: VercelRequest, setHeader: (name: string, value: string) => void): void {
  const origin = req.headers.origin;
  if (typeof origin === "string" && (origin === "null" || origin === "file://" || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) {
    setHeader("Access-Control-Allow-Origin", origin);
    setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    setHeader("Access-Control-Max-Age", "600");
    setHeader("Vary", "Origin");
  }
}
