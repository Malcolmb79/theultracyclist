import type { RouteGeometry } from "../components/race/courseMap";
import { powerUp } from "../components/race/powerUps";

// Where the power-ups are handed out on a route. Zwift gives one (at
// random, from the event's mix) passing under an arch: the start/finish
// banner each lap, and the end of each sprint and KOM. Sauce doesn't know
// the arches themselves, so they're placed from the route: the lap line and
// the segments' finish lines.

export interface Arch {
  /** Metres along the route. */
  at: number;
  kind: "lap" | "sprint" | "climb";
  name: string;
}

/** Closer than this and two arches are drawn as one. */
const SAME_M = 60;

export function powerUpArches(route: RouteGeometry): Arch[] {
  const total = route.distances.at(-1) ?? 0;
  const arches: Arch[] = [{ at: route.leadinM, kind: "lap", name: "Start/finish" }];
  // And the same banner at the end of the lap, coming round again.
  arches.push({ at: total, kind: "lap", name: "Start/finish" });
  for (const s of route.segments) {
    if (s.kind === "segment") continue;
    arches.push({ at: Math.min(s.end, total), kind: s.kind, name: s.name });
  }
  return arches
    .sort((a, b) => a.at - b.at)
    .filter((a, i, all) => i === 0 || a.at - all[i - 1].at > SAME_M);
}

/** The racing power-ups an event's mix can give, most likely first. */
export function likelyPowerUps(odds: Record<string, number> | undefined): { code: string; share: number }[] {
  if (!odds) return [];
  return Object.entries(odds)
    .filter(([code, share]) => share > 0 && powerUp(code))
    .map(([code, share]) => ({ code, share }))
    .sort((a, b) => b.share - a.share);
}
