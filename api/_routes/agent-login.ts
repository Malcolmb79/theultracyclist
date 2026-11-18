import type { VercelRequest, VercelResponse } from "@vercel/node";
import { AGENT_COOKIE_HOURS, AGENT_COOKIE_NAME, verifyAgentKey } from "../_lib/agentAccess.js";

/**
 * For an AI agent that reads the pages in a browser: /api/agent-login?key=…
 * checks the key, sets it as a read-only cookie and goes to the dashboard
 * (or ?to=/dashboard/trends, /dashboard/coaching, /dashboard/meals). From then on the pages
 * load as usual, through the router's read-only gate (api/router.ts).
 */
const PAGES = new Set(["/dashboard", "/dashboard/trends", "/dashboard/coaching", "/dashboard/meals"]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  const key = String(req.query.key ?? "").trim();
  if (!key || !(await verifyAgentKey(key))) {
    res.status(401).setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("That agent key isn't valid - it may have been revoked. Make a new one on the Settings page.");
    return;
  }
  const to = String(req.query.to ?? "/dashboard");
  res.setHeader(
    "Set-Cookie",
    `${AGENT_COOKIE_NAME}=${encodeURIComponent(key)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${AGENT_COOKIE_HOURS * 3600}`,
  );
  res.setHeader("Location", PAGES.has(to) ? to : "/dashboard");
  res.status(302).end();
}
