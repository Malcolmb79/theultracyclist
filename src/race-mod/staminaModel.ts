import type { SauceAthleteData } from "../components/race/sauceFeed";
import { SITE } from "./site";

// Stamina the way Garmin shows it: two tanks.
//
// Potential - the long-term tank. It only drains, at a rate set by how long
// the effort could be held: riding at FTP empties it in the time the rider
// can hold FTP (an hour by default), threshold-ish efforts much faster than
// endurance ones, and easy riding barely touches it. Surges count only up to
// a little over FTP: the rest is the short-term tank's. Never refills on the
// ride.
//
// Current - the short-term tank: what's left for hard efforts right now.
// It drops in surges and comes back when the rider eases off - the W′
// battery - and can never be more than Potential.
//
// For the rider themselves Potential is tracked second by second from this
// ride's power (30-second smoothed, as normalised power is), against their
// own FTP from the site's coaching settings if chosen. For anyone else it's
// estimated from Sauce's totals - their normalised power and time riding.

/**
 * How long an effort can be held, in minutes, with FTP held for an hour -
 * a power-duration curve: long at endurance, an hour at FTP, minutes above.
 * Scaled for riders who hold FTP longer or shorter.
 */
const CURVE: [number, number][] = [
  [0.5, 720],
  [0.6, 480],
  [0.7, 330],
  [0.8, 190],
  [0.85, 135],
  [0.9, 100],
  [0.95, 77],
  [1.0, 60],
  [1.05, 43],
  [1.1, 32],
  [1.2, 18],
  [1.5, 6],
  [2.0, 2.5],
  [3.0, 1],
];

/** Minutes an effort (a share of FTP) could be held. */
export function holdableMin(intensity: number, holdFtpMin = 60): number {
  const scale = holdFtpMin / 60;
  if (intensity <= 0.05) return Infinity;
  if (intensity <= CURVE[0][0]) return CURVE[0][1] * (CURVE[0][0] / intensity) ** 4 * scale;
  const last = CURVE[CURVE.length - 1];
  if (intensity >= last[0]) return last[1] * (last[0] / intensity) ** 2 * scale;
  const i = CURVE.findIndex(([x]) => x >= intensity);
  const [x0, y0] = CURVE[i - 1];
  const [x1, y1] = CURVE[i];
  // Between points on log-log axes, as power-duration curves are.
  const f = Math.log(intensity / x0) / Math.log(x1 / x0);
  return Math.exp(Math.log(y0) + f * (Math.log(y1) - Math.log(y0))) * scale;
}

/**
 * Above this share of FTP the extra is the short-term tank's (W′): a surge
 * empties Current, which refills, rather than the long-term Potential.
 */
const LONG_TERM_CAP = 1.1;

/** Potential drained per second, in percent, at an effort. */
export function drainPerSec(intensity: number, holdFtpMin = 60): number {
  return 100 / (holdableMin(Math.min(intensity, LONG_TERM_CAP), holdFtpMin) * 60);
}

/** Potential from totals alone - a rider not followed all ride: time at their normalised power. */
export function potentialFromTotals(np: number, ftp: number, seconds: number, holdFtpMin = 60): number {
  return Math.max(0, Math.min(100, 100 - seconds * drainPerSec(np / ftp, holdFtpMin)));
}

// --- The rider's own, tracked live ---------------------------------------

const LIVE_KEY = "stamina:live";
/** A gap this long and it's a different ride. */
const NEW_RIDE_MS = 20 * 60_000;
/** Longest step integrated at once (a window that was asleep doesn't drain it in one go). */
const MAX_STEP_MS = 5000;

type Live = { key: string; potential: number; lastAt: number };
const window30: { t: number; w: number }[] = [];

function readLive(): Live | null {
  try {
    return JSON.parse(window.localStorage.getItem(LIVE_KEY) ?? "null") as Live | null;
  } catch {
    return null;
  }
}

/**
 * The rider's own Potential, brought up to date with their power now.
 * Every overlay window showing it calls this; each step is the time since
 * the last one by any of them, so it's never counted twice.
 */
export function trackPotential(r: SauceAthleteData, ftp: number, holdFtpMin: number, fromTotals: number | undefined): number | undefined {
  const now = Date.now();
  const key = `${r.athleteId}:${r.state?.eventSubgroupId || 0}`;
  const w = r.state?.power;
  if (w != null) {
    window30.push({ t: now, w });
    while (window30.length && now - window30[0].t > 30_000) window30.shift();
  }
  let live = readLive();
  if (!live || live.key !== key || now - live.lastAt > NEW_RIDE_MS) {
    // A new ride (or this one picked up partway): from its totals so far, else full.
    live = { key, potential: fromTotals ?? 100, lastAt: now };
  } else if (window30.length) {
    const avg = window30.reduce((a, x) => a + x.w, 0) / window30.length;
    const dt = Math.min(MAX_STEP_MS, now - live.lastAt) / 1000;
    live = { key, potential: Math.max(0, live.potential - dt * drainPerSec(avg / ftp, holdFtpMin)), lastAt: now };
  } else {
    live = { ...live, lastAt: now };
  }
  try {
    window.localStorage.setItem(LIVE_KEY, JSON.stringify(live));
  } catch {
    // Not kept: tracked in this window only.
  }
  return live.potential;
}

// --- Which FTP --------------------------------------------------------------

const SITE_FTP_KEY = "stamina:site-ftp";
const SITE_FTP_MS = 6 * 60 * 60_000;
let siteAsked = false;

/** The FTP in the site's coaching settings, kept a few hours; asked for in the background. */
function keptSiteFtp(): { at: number; ftp: number | null } | null {
  try {
    return JSON.parse(window.localStorage.getItem(SITE_FTP_KEY) ?? "null") as { at: number; ftp: number | null } | null;
  } catch {
    return null;
  }
}

export function siteFtp(): number | undefined {
  const kept = keptSiteFtp();
  if ((!kept || Date.now() - kept.at > SITE_FTP_MS) && !siteAsked) {
    siteAsked = true;
    let key: string | null = null;
    try {
      const raw = window.localStorage.getItem("race:commentary-key");
      key = raw ? (JSON.parse(raw) as string) : null;
    } catch {
      key = null;
    }
    if (key)
      void fetch(`${SITE}/api/race-fitness`, { headers: { authorization: `Bearer ${key}` }, credentials: "omit" })
        .then((res) => (res.ok ? (res.json() as Promise<{ ftpWatts?: number | null }>) : null))
        .then((a) => {
          if (!a) return;
          try {
            window.localStorage.setItem(SITE_FTP_KEY, JSON.stringify({ at: Date.now(), ftp: a.ftpWatts ?? null }));
          } catch {
            // Asked again next time.
          }
        })
        .catch(() => undefined);
  }
  return kept?.ftp ?? undefined;
}

/** The Stamina overlay's settings, shared with the rider cards. */
export function staminaSettings(): { holdMin: number; ftpSource: string } {
  try {
    const v = JSON.parse(window.localStorage.getItem("overlay:stamina") ?? "{}") as { holdMin?: unknown; ftpSource?: unknown };
    return {
      holdMin: typeof v.holdMin === "number" && v.holdMin > 0 ? v.holdMin : 60,
      ftpSource: typeof v.ftpSource === "string" ? v.ftpSource : "site",
    };
  } catch {
    return { holdMin: 60, ftpSource: "site" };
  }
}

const isMe = (r: SauceAthleteData) => r.self === true || (r.self == null && !!r.watching);

/** The FTP stamina is measured against: the rider's own from the site when chosen (and known), else Zwift's. */
export function staminaFtp(r: SauceAthleteData, ftpSource = staminaSettings().ftpSource): number | undefined {
  if (isMe(r) && ftpSource === "site") return siteFtp() ?? r.athlete?.ftp ?? undefined;
  return r.athlete?.ftp ?? undefined;
}

/** Garmin's two numbers for a rider: Potential (long-term) and Current (short-term, at most Potential). */
export function stamina(r: SauceAthleteData, opts = staminaSettings()): { potential: number; current?: number } | undefined {
  const ftp = staminaFtp(r, opts.ftpSource);
  if (!ftp) return undefined;
  const st = (r as { stats?: { power?: { np?: number }; activeTime?: number } }).stats;
  const fromTotals = st?.power?.np && st.activeTime ? potentialFromTotals(st.power.np, ftp, st.activeTime, opts.holdMin) : undefined;
  const potential = isMe(r) ? trackPotential(r, ftp, opts.holdMin, fromTotals) : fromTotals;
  if (potential == null) return undefined;
  const wPrime = r.athlete?.wPrime || 20_000;
  const current = r.wBal != null ? Math.min(potential, Math.max(0, Math.min(100, (r.wBal / wPrime) * 100))) : undefined;
  return { potential, current };
}
