import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSessionEmail } from "../_lib/session.js";

/**
 * A test, opened mid-workout: does Zwift's own account API know which
 * workout is being ridden? Signs in to Zwift with the account the site
 * already uses for ZwiftPower (ZWIFT_USERNAME / ZWIFT_PASSWORD), then shows
 * the profile's riding fields and the latest activities - their titles,
 * timings and anything about a workout - and every field name, so we can
 * see what's there. Nothing secret is shown: no token, password or email.
 *
 * Signed in on the site only: GET /api/zwift-activity-test
 */

const AUTH = "https://secure.zwift.com/auth/realms/zwift/protocol/openid-connect/token";
const API = "https://us-or-rly101.zwift.com";
// Zwift's API answers its own clients; this is how the game introduces itself.
const HEADERS = {
  Accept: "application/json",
  Platform: "OSX",
  Source: "Game Client",
  "User-Agent": "CNL/3.44.0 (Darwin Kernel 23.2.0) zwift/1.0.122968 game/1.54.0 curl/8.4.0",
};

/** Fields worth showing in full: what it is, when, and anything about a workout, plan, route or event. */
const INTERESTING = /workout|plan|name|title|sport|world|route|event|start|end|date|save|duration|moving|distance|riding|activity|progress|hash/i;
/** Never shown. */
const SECRET = /email|token|password|secret|fitfile|key|url|address|phone|dob|birth/i;

function pick(o: unknown): Record<string, unknown> | null {
  if (!o || typeof o !== "object") return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (SECRET.test(k) || !INTERESTING.test(k)) continue;
    out[k] = typeof v === "string" && v.length > 200 ? `${v.slice(0, 200)}…` : v && typeof v === "object" ? pick(v) ?? v : v;
  }
  return out;
}

function fieldNames(o: unknown): string[] {
  return o && typeof o === "object" ? Object.keys(o as object).filter((k) => !SECRET.test(k)) : [];
}

async function get(path: string, token: string): Promise<{ status: number; body: unknown }> {
  const r = await fetch(`${API}${path}`, { headers: { ...HEADERS, Authorization: `Bearer ${token}` } });
  const text = await r.text();
  try {
    return { status: r.status, body: JSON.parse(text) };
  } catch {
    return { status: r.status, body: text.slice(0, 200) };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!getSessionEmail(req)) {
    res.status(401).json({ error: "Sign in to theultracyclist.com first, then open this page again." });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  const steps: string[] = [];
  const username = process.env.ZWIFT_USERNAME;
  const password = process.env.ZWIFT_PASSWORD;
  if (!username || !password) {
    res.status(200).json({ ok: false, steps: ["ZWIFT_USERNAME / ZWIFT_PASSWORD aren't set in Vercel"] });
    return;
  }
  try {
    const auth = await fetch(AUTH, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: "Zwift Game Client", grant_type: "password", username, password }),
    });
    const authBody = (await auth.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
    steps.push(`sign in to Zwift: ${auth.status}`);
    if (!auth.ok || !authBody.access_token) {
      res.status(200).json({ ok: false, steps, error: authBody.error_description ?? "No token" });
      return;
    }
    const token = authBody.access_token;

    const me = await get("/api/profiles/me", token);
    steps.push(`profile: ${me.status}`);
    const profile = me.body as Record<string, unknown>;
    const id = profile?.id;

    const list = await get(`/api/profiles/${id}/activities?start=0&limit=3`, token);
    steps.push(`latest activities: ${list.status}`);
    const activities = Array.isArray(list.body) ? (list.body as Record<string, unknown>[]) : [];

    // The newest one in full, by both of the paths Zwift has used for a single activity.
    let latest: { path: string; status: number; body: unknown } | null = null;
    const newest = activities[0]?.id;
    if (newest != null) {
      for (const path of [`/api/activities/${newest}`, `/api/profiles/${id}/activities/${newest}`]) {
        const one = await get(path, token);
        steps.push(`activity ${path.includes("profiles") ? "(profile path)" : ""}: ${one.status}`);
        if (one.status === 200) {
          latest = { path, ...one };
          break;
        }
      }
    }

    res.status(200).json({
      ok: true,
      steps,
      question: "Is a workout (name, id or hash) in the newest activity while you're riding it?",
      profile: { riding: pick(profile), allFields: fieldNames(profile) },
      activities: activities.map((a) => ({ ...pick(a), allFields: fieldNames(a) })),
      newestInFull: latest ? { ...pick(latest.body), allFields: fieldNames(latest.body) } : null,
    });
  } catch (e) {
    res.status(200).json({ ok: false, steps, error: e instanceof Error ? e.message : "Failed" });
  }
}
