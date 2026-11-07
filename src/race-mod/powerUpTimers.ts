import { POWER_UP_SECONDS } from "./powerUpAdvice";

// How much of a running power-up is left, for the draining ring round its
// badge as Zwift draws it. Sauce says which power-up a rider has running,
// not when it ends, so each is timed from when it was first seen against
// how long that power-up lasts in Zwift - the rider's own uses Zwift's end
// time when it's given.

const seen = new Map<number, { code: string; since: number; last: number }>();
/** Not seen running for this long: a later one is a new use, timed afresh. */
const GONE_MS = 3000;

/** The share left, 1 to 0; undefined when there's nothing to time it by. */
export function powerUpLeft(athleteId: number, code: string | undefined, endsAt?: number | null): number | undefined {
  if (!code) {
    seen.delete(athleteId);
    return undefined;
  }
  const now = Date.now();
  let s = seen.get(athleteId);
  if (!s || s.code !== code || now - s.last > GONE_MS) {
    s = { code, since: now, last: now };
    seen.set(athleteId, s);
  }
  s.last = now;
  const lasts = (POWER_UP_SECONDS[code] ?? 0) * 1000;
  if (endsAt && endsAt > now && lasts) return Math.max(0, Math.min(1, (endsAt - now) / lasts));
  if (!lasts) return undefined;
  return Math.max(0, Math.min(1, 1 - (now - s.since) / lasts));
}
