import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { VercelRequest } from "@vercel/node";
import { parseCookies } from "./session.js";
import { getJSON, readJSON, setJSON } from "./kvStore.js";

/**
 * Read-only access for an AI agent: the dashboard, trends and coaching
 * pages' data, and nothing that changes anything.
 *
 * The athlete makes a key on the Settings page (signed in with a passkey) and
 * hands it to their agent, which uses it one of two ways:
 *   - as a bearer token on GET /api/<route> for the JSON behind the pages, or
 *   - by opening /api/agent-login?key=… in a browser, which sets a read-only
 *     cookie and goes to the dashboard, so the pages themselves can be read.
 *
 * The gate is in one place - api/router.ts - not in each route: an agent
 * request is let through only for GETs to the routes in AGENT_READ_ROUTES,
 * and everything else is refused there before any route runs. Behind the
 * gate the request is treated as the athlete's own, so the routes need no
 * changes. Nothing an agent is handed back ever carries a session: see
 * auth-session.ts, which doesn't renew for an agent.
 *
 * Keys are random and only their hashes are kept, so a key is shown once and
 * can't be recovered - only revoked (which takes effect on the next request).
 */

/** The routes whose GETs an agent may read: what the Dashboard, Trends, Coaching and Meals pages load. */
export const AGENT_READ_ROUTES = new Set([
  "auth-session",
  "activities",
  "strava-activities",
  "strava-photos",
  "garmin-activities",
  "garmin-summary",
  "garmin-timeline",
  "health-data",
  "history.json",
  "live.json",
  "last-location",
  "planned-workouts",
  "trainingpeaks",
  "trainingpeaks-calendar",
  "dashboard-layout",
  "trends-goals",
  "trends-layout",
  "measurements",
  "progress-photos",
  "coaching-settings",
  "coach-knowledge",
  "coach-baseline",
  "race-fitness",
  "max-hr",
  "meal-plan",
]);

/**
 * POSTs that only read: the coaching page asks for the day's coaching
 * summary with a POST (it sends the figures it's showing), which is written
 * once a day and cached - reading it changes nothing of the athlete's.
 */
export const AGENT_READ_POSTS = new Set(["coaching-narrative"]);

// __Host- prefixed for the same reason as the session cookie (see session.ts).
export const AGENT_COOKIE_NAME = "__Host-agent_session";
/** How long the browser cookie from agent-login lasts. The key itself lasts until revoked. */
export const AGENT_COOKIE_HOURS = 12;

const KEY = "agent:keys";
const PREFIX = "uca_";

export interface AgentKey {
  id: string;
  name: string;
  /** sha256 of the whole key. */
  hash: string;
  /** Whose data it reads. */
  email: string;
  createdAt: string;
  lastUsedAt?: string;
}

export type AgentKeySummary = Omit<AgentKey, "hash" | "email">;

const hashOf = (key: string) => createHash("sha256").update(key).digest("hex");

export async function listAgentKeys(): Promise<AgentKey[]> {
  return (await readJSON<AgentKey[]>(KEY)) ?? [];
}

export const summary = ({ hash: _hash, email: _email, ...rest }: AgentKey): AgentKeySummary => rest;

/** A new key - returned whole only now. */
export async function createAgentKey(email: string, name: string): Promise<{ key: string; summary: AgentKeySummary }> {
  const id = randomBytes(6).toString("hex");
  const key = `${PREFIX}${id}_${randomBytes(32).toString("base64url")}`;
  const entry: AgentKey = { id, name: name.slice(0, 60) || "AI agent", hash: hashOf(key), email, createdAt: new Date().toISOString() };
  const keys = await listAgentKeys();
  if (!(await setJSON(KEY, [...keys, entry]))) throw new Error("Storage is unavailable right now - no key was made.");
  return { key, summary: summary(entry) };
}

export async function revokeAgentKey(id: string): Promise<boolean> {
  const keys = await listAgentKeys();
  const left = keys.filter((k) => k.id !== id);
  if (left.length === keys.length) return false;
  return setJSON(KEY, left);
}

/** The key offered with a request, if it looks like one: a bearer token, or the agent-login cookie. */
export function offeredAgentKey(req: VercelRequest): string | null {
  const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
  if (bearer.startsWith(PREFIX)) return bearer;
  const cookie = parseCookies(req.headers.cookie)[AGENT_COOKIE_NAME];
  return cookie?.startsWith(PREFIX) ? cookie : null;
}

/** The key's entry, if it's a current one. */
export async function verifyAgentKey(key: string): Promise<AgentKey | null> {
  const id = key.slice(PREFIX.length).split("_")[0];
  const keys = (await getJSON<AgentKey[]>(KEY)) ?? [];
  const entry = keys.find((k) => k.id === id);
  if (!entry) return null;
  const a = Buffer.from(hashOf(key));
  const b = Buffer.from(entry.hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  // When it was last used, to the hour - enough to see it's in use, without a write every request.
  const hour = new Date().toISOString().slice(0, 13);
  if (entry.lastUsedAt?.slice(0, 13) !== hour) {
    entry.lastUsedAt = new Date().toISOString();
    void setJSON(KEY, keys.map((k) => (k.id === entry.id ? entry : k)));
  }
  return entry;
}
