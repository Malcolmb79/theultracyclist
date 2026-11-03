import { SITE } from "./site";

// Other riders' max heart rates, for colouring their heart rate by zone:
// their highest in any event over the last 90 days, from ZwiftPower through
// the site (api/_routes/zwiftpower-riders.ts). Asked for only for riders
// whose heart rate is on screen, a few at a time, and kept for a day in
// storage, so every overlay window shares what's been found.

const KEY = "hr:zp-max";
const KEEP_MS = 24 * 60 * 60 * 1000;
/** The site asks ZwiftPower for up to 6 a call, spaced out. */
const BATCH = 6;
const EVERY_MS = 3000;

type Kept = Record<string, { at: number; maxHr: number | null }>;

let kept: Kept | null = null;
const queued = new Set<number>();
let timer: ReturnType<typeof setTimeout> | null = null;
/** ZwiftPower isn't set up, or the key isn't accepted: stop asking this session. */
let off = false;

function load(): Kept {
  if (kept) return kept;
  try {
    kept = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Kept;
  } catch {
    kept = {};
  }
  return kept;
}

function save() {
  try {
    const now = Date.now();
    const k = load();
    for (const id of Object.keys(k)) if (now - k[id].at > KEEP_MS) delete k[id];
    window.localStorage.setItem(KEY, JSON.stringify(k));
  } catch {
    // Asked again next time.
  }
}

// Another window found some: use them here too.
window.addEventListener("storage", (e) => {
  if (e.key === KEY) kept = null;
});

function raceKey(): string | null {
  try {
    const raw = window.localStorage.getItem("race:commentary-key");
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return typeof v === "string" && v ? v : null;
  } catch {
    return null;
  }
}

function lookUp() {
  timer = null;
  const key = raceKey();
  const ids = Array.from(queued).slice(0, BATCH);
  if (!key || !ids.length || off) return;
  for (const id of ids) queued.delete(id);
  void fetch(`${SITE}/api/zwiftpower-riders?ids=${ids.join(",")}`, { headers: { authorization: `Bearer ${key}` }, credentials: "omit" })
    .then((r) => {
      if (r.status === 401) off = true;
      return r.ok ? (r.json() as Promise<{ configured?: boolean; riders?: Record<string, { maxHr90Days?: number } | null> }>) : null;
    })
    .then((body) => {
      if (!body) return;
      if (body.configured === false) {
        off = true;
        return;
      }
      const k = load();
      for (const id of ids) if (String(id) in (body.riders ?? {})) k[id] = { at: Date.now(), maxHr: body.riders?.[String(id)]?.maxHr90Days ?? null };
      save();
    })
    .catch(() => {
      // Not now: asked for again when next on screen.
    })
    .finally(() => {
      if (queued.size && !timer) timer = setTimeout(lookUp, EVERY_MS);
    });
}

/** A rider's 90-day max heart rate, if known - otherwise asked for, and known on a later render. */
export function riderMaxHr(athleteId: number | undefined): number | undefined {
  if (!athleteId || off) return undefined;
  const k = load()[athleteId];
  if (k && Date.now() - k.at < KEEP_MS) return k.maxHr ?? undefined;
  if (!queued.has(athleteId)) {
    queued.add(athleteId);
    if (!timer) timer = setTimeout(lookUp, 800);
  }
  return undefined;
}
