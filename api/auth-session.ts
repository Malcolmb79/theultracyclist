import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSessionEmail, renewedSessionCookie } from "./_lib/session.js";

/**
 * Reports auth state, and keeps an in-use session alive while doing it.
 *
 * The dashboard calls this on load and then periodically (see useAuthSession),
 * so each check pushes the idle timeout out and a session being actively
 * watched is never interrupted to ask for a passkey again. Stop watching and
 * it lapses on the normal timeout; the absolute cap in session.ts is what
 * stops sliding from meaning "forever".
 *
 * Renewal lives here rather than in every authenticated endpoint on purpose:
 * one place that deliberately extends a session is far easier to reason about
 * than twenty-seven that would each be doing it as a side effect of fetching
 * data.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const email = getSessionEmail(req);

  if (email) {
    const refreshed = renewedSessionCookie(req);
    if (refreshed) res.setHeader("Set-Cookie", refreshed);
  }

  // Never cached: a stored "authenticated: true" would outlive the session it
  // describes, and this is the answer the whole dashboard gates on.
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json(email ? { authenticated: true, email } : { authenticated: false });
}
