import { getJSON, setJSON } from "./kvStore.js";

// ZwiftPower, read as the athlete: their account signs in with "Login with
// Zwift" (ZWIFT_USERNAME / ZWIFT_PASSWORD in the environment), and the
// session is kept for a few hours so each lookup doesn't log in again.
// ZwiftPower has no public API - this reads the same JSON its own pages
// load - so everything is cached, looked up a few riders at a time, and
// shaped defensively: a field it stops sending just goes missing.
//
// Only riders who share their results with ZwiftPower have any.

const ZP = "https://zwiftpower.com";
const LOGIN_URL = `${ZP}/ucp.php?mode=login&login=external&oauth_service=oauthzpsso`;
const SESSION_KEY = "zwiftpower:session";
const SESSION_MS = 3 * 60 * 60_000;
const RIDER_KEY = (id: number) => `zwiftpower:rider:${id}`;
const RIDER_MS = 6 * 60 * 60_000;
const UA = "Mozilla/5.0 (compatible; TheUltraCyclist race console)";

/** Cookies by domain, enough to carry a login across zwift.com and zwiftpower.com. */
type Jar = Record<string, Record<string, string>>;

function store(jar: Jar, url: string, res: Response) {
  const host = new URL(url).hostname;
  for (const line of res.headers.getSetCookie()) {
    const [pair, ...attrs] = line.split(";");
    const eq = pair.indexOf("=");
    if (eq < 1) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const domainAttr = attrs.map((a) => a.trim()).find((a) => /^domain=/i.test(a));
    const domain = (domainAttr ? domainAttr.slice(7) : host).replace(/^\./, "").toLowerCase();
    jar[domain] ??= {};
    if (value === "" || /max-age=0|expires=thu, 01 jan 1970/i.test(line)) delete jar[domain][name];
    else jar[domain][name] = value;
  }
}

function cookieHeader(jar: Jar, url: string): string {
  const host = new URL(url).hostname.toLowerCase();
  const parts: string[] = [];
  for (const [domain, cookies] of Object.entries(jar)) {
    if (host === domain || host.endsWith(`.${domain}`)) {
      for (const [k, v] of Object.entries(cookies)) parts.push(`${k}=${v}`);
    }
  }
  return parts.join("; ");
}

/** A request that keeps the jar up to date and follows redirects itself, so no cookie is lost on the way. */
async function go(jar: Jar, url: string, init: RequestInit = {}, steps?: string[]): Promise<{ res: Response; url: string }> {
  let current = url;
  let options: RequestInit = init;
  for (let hop = 0; hop < 12; hop++) {
    const res = await fetch(current, {
      ...options,
      redirect: "manual",
      headers: { "User-Agent": UA, ...(options.headers ?? {}), Cookie: cookieHeader(jar, current) },
    });
    store(jar, current, res);
    steps?.push(`${res.status} ${new URL(current).hostname}${new URL(current).pathname}`);
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).toString();
      // A redirect after a form post is a plain GET.
      options = {};
      continue;
    }
    return { res, url: current };
  }
  throw new Error("ZwiftPower login: too many redirects");
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&#x2F;/g, "/").replace(/&#47;/g, "/").replace(/&quot;/g, '"');
}

export class ZwiftPowerUnavailable extends Error {}

/** Logs in through Zwift's sign-in page, as the athlete. Returns the cookies, or throws with what went wrong. */
async function login(steps: string[]): Promise<Jar> {
  const username = process.env.ZWIFT_USERNAME?.trim();
  const password = process.env.ZWIFT_PASSWORD;
  if (!username || !password) throw new ZwiftPowerUnavailable("ZWIFT_USERNAME and ZWIFT_PASSWORD are not set.");
  const jar: Jar = {};
  const page = await go(jar, LOGIN_URL, {}, steps);
  const html = await page.res.text();
  const action = html.match(/<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/i)?.[1] ?? html.match(/<form[^>]*action="([^"]*login-actions[^"]*)"/i)?.[1];
  if (!action) throw new ZwiftPowerUnavailable(`ZwiftPower login: no Zwift sign-in form found (ended at ${page.url}).`);
  const done = await go(
    jar,
    new URL(decodeEntities(action), page.url).toString(),
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username, password, rememberMe: "on", credentialId: "" }).toString(),
    },
    steps,
  );
  const after = await done.res.text();
  if (/kc-form-login|invalid username or password|Invalid email or password/i.test(after)) {
    throw new ZwiftPowerUnavailable("ZwiftPower login: Zwift didn't accept the email and password.");
  }
  if (!new URL(done.url).hostname.endsWith("zwiftpower.com")) {
    throw new ZwiftPowerUnavailable(`ZwiftPower login: ended at ${done.url} rather than back on ZwiftPower.`);
  }
  // A page visit hands out the cookies that unlock ZwiftPower's data files.
  await go(jar, `${ZP}/profile.php`, {}, steps);
  return jar;
}

async function session(steps: string[], fresh = false): Promise<Jar> {
  if (!fresh) {
    const saved = await getJSON<{ at: number; jar: Jar }>(SESSION_KEY);
    if (saved && Date.now() - saved.at < SESSION_MS) return saved.jar;
  }
  const jar = await login(steps);
  await setJSON(SESSION_KEY, { at: Date.now(), jar });
  return jar;
}

/** ZwiftPower's JSON, logging in again once if the session has gone stale. */
async function zpJSON(path: string, steps: string[]): Promise<unknown> {
  for (const fresh of [false, true]) {
    const jar = await session(steps, fresh);
    const { res } = await go(jar, `${ZP}${path}`, {}, steps);
    const type = res.headers.get("content-type") ?? "";
    if (res.ok && /json|javascript|text\/plain/.test(type)) {
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        if (fresh) throw new Error(`ZwiftPower sent something other than JSON for ${path}`);
        continue;
      }
    }
    if (res.status === 404) return null;
    if (fresh) throw new Error(`ZwiftPower answered ${res.status} for ${path}`);
  }
  return null;
}

/** ZwiftPower sends many numbers as [value, flag] pairs, or as strings. */
function num(v: unknown): number | undefined {
  const x = Array.isArray(v) ? v[0] : v;
  const n = typeof x === "number" ? x : typeof x === "string" ? Number.parseFloat(x) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function str(v: unknown): string | undefined {
  const x = Array.isArray(v) ? v[0] : v;
  return typeof x === "string" && x.trim() ? x.trim() : undefined;
}

export interface RiderHistory {
  /** The ZwiftPower category from their latest race. */
  category?: string;
  last30Days: { races: number; wins: number; podiums: number; top10: number };
  last90Days: { races: number; wins: number; podiums: number };
  /** Their latest few results, newest first. */
  recent: { date: string; event: string; place?: number; category?: string; wkg?: number }[];
  /** Best watts per kilo in races over the last 90 days. */
  best90Days?: { s15?: number; m1?: number; m5?: number; m20?: number };
}

export function summarise(results: unknown): RiderHistory | null {
  const list = (Array.isArray(results) ? results : ((results as { data?: unknown[] } | null)?.data ?? [])) as Record<string, unknown>[];
  const races = list
    .map((r) => {
      const t = num(r.event_date) ?? num(r.date);
      // f_t is the event type: TYPE_RACE, TYPE_RIDE (group rides), TYPE_GROUP_WORKOUT...
      const type = str(r.f_t);
      return {
        at: t != null ? (t > 1e12 ? t : t * 1000) : undefined,
        event: str(r.event_title) ?? "Race",
        place: num(r.position_in_cat) ?? num(r.pos),
        category: str(r.category),
        wkg: num(r.avg_wkg),
        // Each result carries the rider's best efforts in that race, as W/kg.
        efforts: { s15: num(r.wkg15), m1: num(r.wkg60), m5: num(r.wkg300), m20: num(r.wkg1200) },
        race: !type || /RACE|TIME_TRIAL|TT/i.test(type),
        dq: !!num(r.dq) || str(r.dq) === "1",
      };
    })
    .filter((r) => r.at != null && r.race && !r.dq)
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  if (!races.length) return null;

  const since = (days: number) => races.filter((r) => Date.now() - (r.at ?? 0) <= days * 86_400_000);
  const tally = (rs: typeof races) => ({
    races: rs.length,
    wins: rs.filter((r) => r.place === 1).length,
    podiums: rs.filter((r) => r.place != null && r.place <= 3).length,
    top10: rs.filter((r) => r.place != null && r.place <= 10).length,
  });
  const m30 = tally(since(30));
  const m90 = tally(since(90));

  // Their best efforts over the last 90 days, from the races in it.
  const recentRaces = since(90);
  const best = (k: "s15" | "m1" | "m5" | "m20") => {
    const vals = recentRaces.map((r) => r.efforts[k]).filter((v): v is number => v != null && v > 0);
    return vals.length ? Math.round(Math.max(...vals) * 10) / 10 : undefined;
  };
  const best90Days = recentRaces.length ? { s15: best("s15"), m1: best("m1"), m5: best("m5"), m20: best("m20") } : undefined;

  return {
    category: races[0]?.category,
    last30Days: m30,
    last90Days: { races: m90.races, wins: m90.wins, podiums: m90.podiums },
    recent: races.slice(0, 3).map((r) => ({
      date: new Date(r.at ?? 0).toISOString().slice(0, 10),
      event: r.event.slice(0, 60),
      place: r.place,
      category: r.category,
      wkg: r.wkg != null ? Math.round(r.wkg * 10) / 10 : undefined,
    })),
    best90Days,
  };
}

/** One rider's history, from the cache when it's fresh. Null when ZwiftPower has nothing for them. */
export async function riderHistory(id: number, steps: string[] = []): Promise<RiderHistory | null> {
  const cached = await getJSON<{ at: number; history: RiderHistory | null }>(RIDER_KEY(id));
  if (cached && Date.now() - cached.at < RIDER_MS) return cached.history;
  const results = await zpJSON(`/cache3/profile/${id}_all.json`, steps);
  const history = summarise(results);
  await setJSON(RIDER_KEY(id), { at: Date.now(), history });
  return history;
}

/** For the diagnostic page: the raw shape of what ZwiftPower sent for a rider, trimmed. */
/** The logged-in athlete's own Zwift id: ZwiftPower's profile page without an id is their own. */
async function ownId(steps: string[]): Promise<number | undefined> {
  const jar = await session(steps, true);
  const { res, url } = await go(jar, `${ZP}/profile.php`, {}, steps);
  const fromUrl = new URL(url).searchParams.get("z");
  const html = fromUrl ? "" : await res.text();
  const z = fromUrl ?? html.match(/profile\.php\?z=(\d+)/)?.[1];
  return z ? Number(z) : undefined;
}

export async function rawSample(idOrSelf: number | undefined, steps: string[]) {
  const id = idOrSelf ?? (await ownId(steps));
  if (!id) return { error: "Logged in, but couldn't find your own Zwift id on ZwiftPower." };
  const results = await zpJSON(`/cache3/profile/${id}_all.json`, steps);
  const list = (Array.isArray(results) ? results : ((results as { data?: unknown[] } | null)?.data ?? [])) as unknown[];
  return {
    zwiftId: id,
    resultCount: list.length,
    // What the commentator would be given for them.
    summary: summarise(results),
  };
}
