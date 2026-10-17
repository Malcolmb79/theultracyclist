import type { VercelRequest, VercelResponse } from "@vercel/node";

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
  "coach-knowledge": () => import("./_routes/coach-knowledge.js"),
  "coaching-chat": () => import("./_routes/coaching-chat.js"),
  "coaching-narrative": () => import("./_routes/coaching-narrative.js"),
  "coaching-settings": () => import("./_routes/coaching-settings.js"),
  "cron-refresh": () => import("./_routes/cron-refresh.js"),
  "dashboard-layout": () => import("./_routes/dashboard-layout.js"),
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

  const route = await load();
  return route.default(req, res);
}
