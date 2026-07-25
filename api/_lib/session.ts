import { createHmac, timingSafeEqual } from "node:crypto";
import type { VercelRequest } from "@vercel/node";

export const SESSION_COOKIE_NAME = "dash_session";
export const OAUTH_STATE_COOKIE_NAME = "oauth_state";
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function createSessionCookieValue(email: string, secret: string): string {
  const payload = Buffer.from(JSON.stringify({ email, exp: Date.now() + SESSION_MAX_AGE_MS })).toString(
    "base64url",
  );
  return `${payload}.${sign(payload, secret)}`;
}

function verifySessionToken(token: string, secret: string): { email: string } | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;

  const expectedSig = sign(payload, secret);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      email?: string;
      exp?: number;
    };
    if (!data.email || typeof data.exp !== "number" || data.exp < Date.now()) return null;
    return { email: data.email };
  } catch {
    return null;
  }
}

export function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function getSessionEmail(req: VercelRequest): string | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME];
  if (!token) return null;
  return verifySessionToken(token, secret)?.email ?? null;
}

// The id_token here comes from a direct server-to-server exchange with
// Microsoft's token endpoint (confidential client, over TLS, authenticated
// with our client secret) rather than from something a browser handed us -
// so full JWKS signature verification is unnecessary defense in depth here.
// We still sanity-check the claims we actually rely on.
export function decodeIdTokenClaims(idToken: string, expectedAudience: string): Record<string, unknown> | null {
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return null;
    if (payload.aud !== expectedAudience) return null;
    return payload;
  } catch {
    return null;
  }
}

export function isAllowedEmail(email: string): boolean {
  const allowlist = (process.env.ALLOWED_M365_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return allowlist.includes(email.toLowerCase());
}
