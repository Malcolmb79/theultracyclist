import type { VercelRequest, VercelResponse } from "@vercel/node";
import { LEGACY_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME } from "../_lib/session.js";

/**
 * Signs out. POST only, and only from this site's own pages.
 *
 * A GET sign-out let any other site log a visitor out with a plain link or
 * redirect, since the browser sends the Lax session cookie on top-level
 * navigations. Requiring POST is not enough on its own - a cross-site form
 * POST is a top-level navigation too - so the request must also come from
 * this origin, by the browser's own Sec-Fetch-Site header or, failing that,
 * Origin.
 */

function sameOrigin(req: VercelRequest): boolean {
  const site = req.headers["sec-fetch-site"];
  if (typeof site === "string") return site === "same-origin";
  const origin = req.headers.origin;
  if (typeof origin !== "string") return false;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!sameOrigin(req)) {
    res.status(403).json({ error: "Cross-site sign-out refused" });
    return;
  }

  res.setHeader("Set-Cookie", [
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    `${LEGACY_SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  ]);
  // 303 so the browser follows a form POST with a GET.
  res.writeHead(303, { Location: "/dashboard" });
  res.end();
}
