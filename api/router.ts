import type { VercelRequest, VercelResponse } from "@vercel/node";
import { AGENT_COOKIE_NAME, AGENT_READ_POSTS, AGENT_READ_ROUTES, offeredAgentKey, verifyAgentKey } from "./_lib/agentAccess.js";
import { SESSION_COOKIE_NAME, createSessionCookieValue, getSession } from "./_lib/session.js";

// The only serverless function. The Hobby plan allows 12 per deployment and
// the site has ~40 routes, so every /api/<name> URL is rewritten here (see
// vercel.json) and dispatched to api/_routes/<name>.ts - Vercel doesn't turn
// files under an underscore folder into functions. URLs are unchanged.
//
// Each route loads on first use, so a cold start pays only for the route
// being called rather than every route's dependencies. The import paths
// must stay string literals: Vercel bundles what it can trace statically.

type Handler = (req: VercelRequest, res: VercelResponse) => unknown;
type RouteModule = { default: Handler };

const ROUTES: Record<string, () => Promise<RouteModule>> = {
  "activities": () => import("./_routes/activities.js"),
  "auth-callback": () => import("./_routes/auth-callback.js"),
  "auth-login": () => import("./_routes/auth-login.js"),
  "auth-logout": () => import("./_routes/auth-logout.js"),
  "auth-session": () => import("./_routes/auth-session.js"),
  "agent-keys": () => import("./_routes/agent-keys.js"),
  "agent-login": () => import("./_routes/agent-login.js"),
  "coach-baseline": () => import("./_routes/coach-baseline.js"),
  "coach-knowledge": () => import("./_routes/coach-knowledge.js"),
  "coaching-chat": () => import("./_routes/coaching-chat.js"),
  "coaching-narrative": () => import("./_routes/coaching-narrative.js"),
  "coaching-settings": () => import("./_routes/coaching-settings.js"),
  "cron-refresh": () => import("./_routes/cron-refresh.js"),
  "dashboard-layout": () => import("./_routes/dashboard-layout.js"),
  "env-check": () => import("./_routes/env-check.js"),
  "describe-figure": () => import("./_routes/describe-figure.js"),
  "garmin-activities": () => import("./_routes/garmin-activities.js"),
  "garmin-summary": () => import("./_routes/garmin-summary.js"),
  "garmin-timeline": () => import("./_routes/garmin-timeline.js"),
  "health-data": () => import("./_routes/health-data.js"),
  "history.json": () => import("./_routes/history.json.js"),
  "ingest": () => import("./_routes/ingest.js"),
  "last-location": () => import("./_routes/last-location.js"),
  "live-tracker": () => import("./_routes/live-tracker.js"),
  "live.json": () => import("./_routes/live.json.js"),
  "measurements-extract": () => import("./_routes/measurements-extract.js"),
  "measurements": () => import("./_routes/measurements.js"),
  "passkeys": () => import("./_routes/passkeys.js"),
  "planned-workouts": () => import("./_routes/planned-workouts.js"),
  "progress-photos": () => import("./_routes/progress-photos.js"),
  "race-commentary": () => import("./_routes/race-commentary.js"),
  "race-fitness": () => import("./_routes/race-fitness.js"),
  "race-token": () => import("./_routes/race-token.js"),
  "race-voice": () => import("./_routes/race-voice.js"),
  "send-checkin": () => import("./_routes/send-checkin.js"),
  "site-photos": () => import("./_routes/site-photos.js"),
  "site-portrait": () => import("./_routes/site-portrait.js"),
  "strava-activities": () => import("./_routes/strava-activities.js"),
  "strava-photos": () => import("./_routes/strava-photos.js"),
  "traccar-osmand": () => import("./_routes/traccar-osmand.js"),
  "tracker-reset": () => import("./_routes/tracker-reset.js"),
  "tracker-simulate": () => import("./_routes/tracker-simulate.js"),
  "trainingpeaks-calendar": () => import("./_routes/trainingpeaks-calendar.js"),
  "trainingpeaks": () => import("./_routes/trainingpeaks.js"),
  "trends-goals": () => import("./_routes/trends-goals.js"),
  "trends-layout": () => import("./_routes/trends-layout.js"),
  "whatsapp-webhook": () => import("./_routes/whatsapp-webhook.js"),
  "widget-image": () => import("./_routes/widget-image.js"),
  "zwiftpower-riders": () => import("./_routes/zwiftpower-riders.js"),
  "zwift-profile": () => import("./_routes/zwift-profile.js"),
  "max-hr": () => import("./_routes/max-hr.js"),
  "meal-plan": () => import("./_routes/meal-plan.js"),
  "zwift-signups": () => import("./_routes/zwift-signups.js"),
  "zwift-riders": () => import("./_routes/zwift-riders.js"),
  "youtube-chat": () => import("./_routes/youtube-chat.js"),
};

const ROUTE_PARAM = "__route";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const param = req.query[ROUTE_PARAM] ?? url.searchParams.get(ROUTE_PARAM);
  const name = (Array.isArray(param) ? param.join("/") : param) ?? url.pathname.replace(/^\/api\//, "");
  const load = Object.hasOwn(ROUTES, name) ? ROUTES[name] : undefined;
  if (!load) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Routes see the request exactly as it arrived: the Twilio webhook signs
  // over the full URL, so the query is filtered as raw text rather than
  // re-serialised, which could change its encoding.
  delete req.query[ROUTE_PARAM];
  const rawQuery = (req.url ?? "").split("?")[1] ?? "";
  const kept = rawQuery.split("&").filter((part) => part && !part.startsWith(`${ROUTE_PARAM}=`));
  req.url = `/api/${name}${kept.length > 0 ? `?${kept.join("&")}` : ""}`;

  if (name !== "agent-login" && !(await agentGate(req, res, name))) return;

  const route = await load();
  return route.default(req, res);
}

/** Set on a request that came in on a read-only agent key (see api/_lib/agentAccess.ts). */
export const AGENT_FLAG = "x-ultracyclist-agent";

/**
 * The read-only gate for AI agent keys. A request carrying one may only GET
 * the routes the Dashboard, Trends and Coaching pages read; anything else is
 * refused here. A request it lets through is handed on as the athlete's own -
 * a session made for this request alone, never sent back - so the routes
 * behind it need no changes. Returns false when it has already answered.
 */
async function agentGate(req: VercelRequest, res: VercelResponse, name: string): Promise<boolean> {
  delete req.headers[AGENT_FLAG];
  const key = offeredAgentKey(req);
  if (!key) return true;
  const fromCookie = !(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim().startsWith("uca_");
  // The athlete's own sign-in wins over an agent cookie left in the same browser.
  if (fromCookie && getSession(req)) return true;
  const entry = await verifyAgentKey(key);
  const secret = process.env.SESSION_SECRET;
  if (!entry || !secret) {
    res.setHeader("Cache-Control", "no-store");
    res.status(401).json({ error: "That agent key isn't valid - it may have been revoked." });
    return false;
  }
  const reads = req.method === "GET" || req.method === "HEAD" ? AGENT_READ_ROUTES.has(name) : req.method === "POST" && AGENT_READ_POSTS.has(name);
  if (!reads) {
    res.setHeader("Cache-Control", "no-store");
    res.status(403).json({ error: "This key is read-only: it can read the dashboard, trends, coaching and meals data, and nothing else.", code: "agent-read-only" });
    return false;
  }
  const others = (req.headers.cookie ?? "")
    .split(";")
    .map((c) => c.trim())
    .filter((c) => c && !c.startsWith(`${SESSION_COOKIE_NAME}=`) && !c.startsWith(`${AGENT_COOKIE_NAME}=`));
  req.headers.cookie = [...others, `${SESSION_COOKIE_NAME}=${createSessionCookieValue(entry.email, secret, "passkey")}`].join("; ");
  delete req.headers.authorization;
  req.headers[AGENT_FLAG] = "1";
  return true;
}
