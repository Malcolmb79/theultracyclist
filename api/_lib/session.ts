import { createHmac, timingSafeEqual } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const SESSION_COOKIE_NAME = "dash_session";
export const OAUTH_STATE_COOKIE_NAME = "oauth_state";
export const WHOOP_OAUTH_STATE_COOKIE_NAME = "whoop_oauth_state";
/**
 * How long a session stays valid once issued.
 *
 * Deliberately short. The dashboard is meant to ask for a passkey when it's
 * opened, not to hand out a month of access in exchange for one Face ID.
 * Paired with a cookie that carries no Max-Age (see the Set-Cookie headers in
 * auth-callback.ts and passkeys.ts): that makes it a browser-session cookie,
 * so closing the browser or the app ends it regardless of this value.
 *
 * Tunable via SESSION_TTL_MINUTES without a code change. The ceiling stops a
 * stray value from quietly restoring the old month-long session.
 */
const DEFAULT_SESSION_TTL_MINUTES = 60;
const MAX_SESSION_TTL_MINUTES = 24 * 60;

function sessionTtlMs(): number {
  const configured = Number(process.env.SESSION_TTL_MINUTES);
  const minutes =
    Number.isFinite(configured) && configured > 0
      ? Math.min(configured, MAX_SESSION_TTL_MINUTES)
      : DEFAULT_SESSION_TTL_MINUTES;
  return minutes * 60 * 1000;
}

/**
 * The longest a session can live no matter how much it is used.
 *
 * The TTL above is an *idle* timeout now - it slides forward while the
 * dashboard is open (see renewedSessionCookie), because being asked for a
 * passkey mid-ride while watching a page is the kind of friction that gets a
 * security control switched off. This is the ceiling that stops sliding from
 * meaning "forever": a tab left open on a spare screen is not a good reason to
 * hold an authenticated session indefinitely.
 *
 * Measured from first sign-in, not last use. Once it passes, the next request
 * needs a real passkey gesture again.
 */
const DEFAULT_SESSION_ABSOLUTE_HOURS = 12;
const MAX_SESSION_ABSOLUTE_HOURS = 24 * 7;

function sessionAbsoluteMs(): number {
  const configured = Number(process.env.SESSION_ABSOLUTE_HOURS);
  const hours =
    Number.isFinite(configured) && configured > 0
      ? Math.min(configured, MAX_SESSION_ABSOLUTE_HOURS)
      : DEFAULT_SESSION_ABSOLUTE_HOURS;
  return hours * 60 * 60 * 1000;
}

/**
 * How the session was authenticated.
 *
 * Recorded because the two are not equivalent. A Microsoft sign-in completes
 * silently whenever that session is still live in the browser, so it proves
 * the browser was once signed in; a passkey proves someone was present and
 * authenticated on this device, just now. The coaching side requires the
 * second - see requirePasskeySession.
 */
export type AuthMethod = "passkey" | "microsoft";

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function createSessionCookieValue(
  email: string,
  secret: string,
  amr: AuthMethod,
  issuedAt = Date.now(),
): string {
  // iat is carried so the absolute cap survives renewal - without it, each
  // slide forward would forget when the session actually started and the
  // ceiling could never be reached.
  const payload = Buffer.from(
    JSON.stringify({ email, amr, iat: issuedAt, exp: Date.now() + sessionTtlMs() }),
  ).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

/**
 * The session cookie, without Max-Age on purpose - see sessionTtlMs above.
 * Shared so the OAuth callback and the passkey verify can't drift apart on
 * cookie flags, which is exactly the kind of difference that turns into "it
 * logs out on my phone but not my laptop".
 */
export function sessionCookieHeader(
  email: string,
  secret: string,
  amr: AuthMethod,
  issuedAt = Date.now(),
): string {
  return `${SESSION_COOKIE_NAME}=${createSessionCookieValue(email, secret, amr, issuedAt)}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function verifySessionToken(token: string, secret: string): { email: string; amr: AuthMethod; iat: number } | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;

  const expectedSig = sign(payload, secret);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      email?: string;
      amr?: string;
      iat?: number;
      exp?: number;
    };
    if (!data.email || typeof data.exp !== "number" || data.exp < Date.now()) return null;
    // Cookies issued before iat existed are treated as starting now. That
    // extends one session's absolute window once, on the changeover, rather
    // than signing everyone out mid-use for a field they couldn't have had.
    const iat = typeof data.iat === "number" ? data.iat : Date.now();
    if (Date.now() - iat > sessionAbsoluteMs()) return null;
    // A cookie from before amr existed is treated as the weaker method. It
    // grants what it always granted and no more - inferring "passkey" from
    // its absence would hand coaching access to every session already issued.
    const amr: AuthMethod = data.amr === "passkey" ? "passkey" : "microsoft";
    return { email: data.email, amr, iat };
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

export function getSession(req: VercelRequest): { email: string; amr: AuthMethod } | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME];
  if (!token) return null;
  const session = verifySessionToken(token, secret);
  return session ? { email: session.email, amr: session.amr } : null;
}

export function getSessionEmail(req: VercelRequest): string | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME];
  if (!token) return null;
  return verifySessionToken(token, secret)?.email ?? null;
}

/**
 * A refreshed cookie for a session that is still valid, or null.
 *
 * This is what makes the idle timeout slide: while the dashboard is open it
 * checks in periodically, each check pushes the expiry out, and an active
 * session is never interrupted to ask for a passkey again. Stop using it and
 * it lapses on the normal timeout.
 *
 * Renewal cannot extend a session past its absolute cap, because the original
 * iat is carried through unchanged - verifySessionToken has already refused
 * anything beyond it by the time this runs, and the new cookie is stamped with
 * the same start rather than a fresh one.
 *
 * Returns null rather than throwing when there is no valid session: the caller
 * is reporting auth state, and a missing cookie is an answer, not an error.
 */
export function renewedSessionCookie(req: VercelRequest): string | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME];
  if (!token) return null;
  const session = verifySessionToken(token, secret);
  if (!session) return null;
  // amr is carried through renewal: sliding a session forward must not
  // quietly upgrade how it was authenticated.
  return sessionCookieHeader(session.email, secret, session.amr, session.iat);
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

/**
 * Gate for the coaching side, which is held to a higher bar than the rest of
 * the dashboard.
 *
 * Everything else is happy with a Microsoft session. Coaching is not: it holds
 * the athlete's own coaching notes and drives an assistant that reads their
 * whole training history, so it asks for proof that someone is present on this
 * device now, rather than that this browser signed in at some point.
 *
 * Returns true when the request may proceed. When it returns false it has
 * already answered - 401 for no session at all, 403 with a code the client
 * uses to offer a passkey prompt instead of a sign-in page, since the session
 * itself is perfectly valid and being signed out would be wrong.
 */
export function requirePasskeySession(req: VercelRequest, res: VercelResponse): boolean {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  if (session.amr !== "passkey") {
    res.status(403).json({ error: "Coaching needs a passkey.", code: "passkey-required" });
    return false;
  }
  return true;
}
