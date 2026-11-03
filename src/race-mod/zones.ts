import { SITE } from "./site";
import { riderMaxHr } from "./riderMaxHr";

// Coggan power zones, as a share of FTP, with the colour Zwift uses for each -
// shared by the power overlay and the workout strip.

export const POWER_ZONES = [
  { upTo: 0.6, name: "Z1", color: "#9aa4ae" },
  { upTo: 0.76, name: "Z2", color: "#3b82f6" },
  { upTo: 0.9, name: "Z3", color: "#2ee6a6" },
  { upTo: 1.05, name: "Z4", color: "#ffd23f" },
  { upTo: 1.18, name: "Z5", color: "#ff9a2e" },
  { upTo: Infinity, name: "Z6", color: "#ff4d2e" },
];

export function zoneColor(share: number): string {
  return (POWER_ZONES.find((z) => share <= z.upTo) ?? POWER_ZONES[POWER_ZONES.length - 1]).color;
}

// Heart-rate zones, as a share of the rider's maximum heart rate, in the same
// colours: easy grey, endurance blue, tempo green, threshold yellow, max red.
export const HR_ZONES = [
  { upTo: 0.6, name: "Z1", color: "#9aa4ae" },
  { upTo: 0.7, name: "Z2", color: "#3b82f6" },
  { upTo: 0.8, name: "Z3", color: "#2ee6a6" },
  { upTo: 0.9, name: "Z4", color: "#ffd23f" },
  { upTo: Infinity, name: "Z5", color: "#ff4d2e" },
];

/**
 * The max heart rate setting, shared by every overlay: "strava" (the highest
 * on the rider's Strava rides over the last 90 days, through the site),
 * "learn" (the highest seen on rides here) or bpm.
 */
export const MAX_HR_KEY = "hr:max";
const LEARNT_KEY = "hr:learnt-max";
/** Until a hard enough ride has been seen to learn from. */
const DEFAULT_MAX_HR = 185;

function stored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function maxHrSetting(): string {
  return stored(MAX_HR_KEY) ?? "strava";
}

export function saveMaxHrSetting(v: string) {
  try {
    window.localStorage.setItem(MAX_HR_KEY, v);
  } catch {
    // Not kept: the default is used.
  }
}

/** The rider's max heart rate - set, or learnt from the highest seen on their rides (at least 185 until then). */
export function myMaxHr(bpm?: number): number {
  const setting = maxHrSetting();
  const set = Number(setting);
  if (set > 0) return set;
  if (setting === "strava") {
    const fromStrava = stravaMaxHr();
    if (fromStrava) return fromStrava;
  }
  let learnt = Number(stored(LEARNT_KEY)) || 0;
  if (bpm != null && bpm > learnt && bpm < 225) {
    learnt = bpm;
    try {
      window.localStorage.setItem(LEARNT_KEY, String(bpm));
    } catch {
      // Learnt again next ride.
    }
  }
  // Early on the highest seen is just today's: never taken below the usual max, so zones aren't all red.
  return Math.max(learnt, DEFAULT_MAX_HR);
}

/**
 * A heart rate's zone colour: the rider's own from their max heart rate
 * setting, anyone else's from their 90-day max on ZwiftPower (plain until
 * it's known, or if they've no heart rate there).
 */
export function hrColour(
  r: { self?: boolean; watching?: boolean; athleteId?: number } | null | undefined,
  bpm: number | null | undefined,
  learn = false,
): string | undefined {
  if (!r || !bpm) return undefined;
  // Sauce marks the rider's own data; the one watched counts unless it says it isn't them.
  const mine = r.self === true || (r.self == null && r.watching);
  const max = mine ? myMaxHr(learn ? bpm : undefined) : riderMaxHr(r.athleteId);
  if (!max) return undefined;
  return (HR_ZONES.find((z) => bpm / max <= z.upTo) ?? HR_ZONES[HR_ZONES.length - 1]).color;
}

/** The 90-day max from Strava, kept for 12 hours between windows and rides; asked for again in the background. */
const STRAVA_KEY = "hr:strava-max";
const STRAVA_MS = 12 * 60 * 60 * 1000;
let stravaAsked = false;

function readKept(): { at: number; maxHr: number | null } | null {
  try {
    return JSON.parse(stored(STRAVA_KEY) ?? "null") as { at: number; maxHr: number | null } | null;
  } catch {
    return null;
  }
}

function stravaMaxHr(): number | undefined {
  const kept = readKept();
  if ((!kept || Date.now() - kept.at > STRAVA_MS) && !stravaAsked) {
    stravaAsked = true;
    const key = raceKey();
    if (key)
      void fetch(`${SITE}/api/max-hr`, { headers: { authorization: `Bearer ${key}` }, credentials: "omit" })
        .then((r) => (r.ok ? (r.json() as Promise<{ maxHr?: number | null; error?: string }>) : null))
        .then((a) => {
          if (!a || a.error) return;
          try {
            window.localStorage.setItem(STRAVA_KEY, JSON.stringify({ at: Date.now(), maxHr: a.maxHr ?? null }));
          } catch {
            // Asked again next time.
          }
        })
        .catch(() => undefined);
  }
  return kept?.maxHr ?? undefined;
}

/** The race key the mod's radio overlays already keep, shared by every mod window. */
function raceKey(): string | null {
  try {
    const raw = window.localStorage.getItem("race:commentary-key");
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return typeof v === "string" && v ? v : null;
  } catch {
    return null;
  }
}
