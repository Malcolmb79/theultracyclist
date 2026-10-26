import type { RouteGeometry } from "../components/race/courseMap";
import { courseAhead } from "./courseAhead";
import { findClimb } from "./climb";
import { BIKE_KG, gradeBetween, speedFor } from "./physics";

// When to use the power-up the rider is holding, from the road ahead and
// how long it lasts - so it runs out exactly where it pays:
// - Aero helmet, Van, Burrito: timed to end on the next sprint line, or the
//   finish, whichever comes first.
// - Feather: on the steepest part of the next climb, as much road as it
//   lasts - or timed to end at the top, if that's the choice.
// - Steamroller, Anvil: from the top of the next descent.
// - Ghost: anywhere - it's for a surprise attack - so a tactic, not a place.

/** Roughly how long each lasts in Zwift, in seconds. The game's own timer takes over once one is used. */
export const POWER_UP_SECONDS: Record<string, number> = {
  LIGHTNESS: 15,
  DRAFTBOOST: 30,
  AERO: 30,
  UNDRAFTABLE: 10,
  NINJA: 10,
  STEAMROLLER: 15,
  ANVIL: 30,
};

export interface Advice {
  /** Metres to the point to use it; 0 or less means now. Undefined for a tactic with no place. */
  inM?: number;
  /** Where it's aimed at, in words. */
  why: string;
}

/** How far ahead to look for a place to use it. */
const LOOK_M = 15_000;
/** Within this, it's time to use it. */
export const NOW_M = 25;

interface Rider {
  /** Where they are on the route (see routePosition). */
  at: number;
  /** Metres to the finish, when the event is a distance. */
  remainingM?: number;
  kmh: number;
  watts: number;
  weightKg: number;
}

export function adviseUse(code: string, route: RouteGeometry, rider: Rider, featherAt: "steepest" | "top"): Advice | undefined {
  const secs = POWER_UP_SECONDS[code];
  if (!secs) return undefined;
  const flatV = Math.max(5, rider.kmh / 3.6);
  const ahead = courseAhead(route, rider.at, rider.remainingM);
  const finish = rider.remainingM != null && rider.remainingM > 0 && rider.remainingM <= LOOK_M ? rider.remainingM : undefined;

  if (code === "AERO" || code === "DRAFTBOOST" || code === "UNDRAFTABLE") {
    // The next line to cross with it still running: a sprint's end, or the finish.
    const sprint = ahead.current?.kind === "sprint" ? { endM: ahead.current.toGoM, name: ahead.current.name } : undefined;
    const next = ahead.next.find((n) => n.kind === "sprint");
    const lines = [
      sprint && { endM: sprint.endM, why: `so it lasts to the ${sprint.name} line` },
      next && { endM: (next.inKm + next.lengthKm) * 1000, why: `so it lasts to the ${next.name} line` },
      finish != null && { endM: finish, why: "so it lasts to the finish" },
    ].filter((x): x is { endM: number; why: string } => !!x);
    const target = lines.sort((a, b) => a.endM - b.endM)[0];
    if (!target) return { why: code === "UNDRAFTABLE" ? "Use it to attack - nobody can sit on your wheel." : "Save it for the next sprint or the finish." };
    return { inM: target.endM - flatV * secs, why: target.why };
  }

  if (code === "LIGHTNESS") {
    const climb = findClimb(route, rider.at, 5000, "standard");
    if (!climb) return { why: "Save it for the next climb." };
    // Climbing speed at their power, roughly, on the climb's own gradient.
    const v = Math.max(2, speedFor(rider.watts, climb.avgPct / 100, rider.weightKg + BIKE_KG, 0.32));
    const len = v * secs;
    if (featherAt === "top" || climb.top - climb.start <= len) {
      return { inM: Math.max(climb.start, climb.top - len) - rider.at, why: `so it lasts to the top of ${climb.name ?? "the climb"}` };
    }
    // The steepest stretch the feather's time covers.
    let best = climb.start;
    let bestGrade = -Infinity;
    for (let d = Math.max(climb.start, rider.at); d + len <= climb.top; d += 10) {
      const g = gradeBetween(route, d, d + len);
      if (g > bestGrade) {
        bestGrade = g;
        best = d;
      }
    }
    return { inM: best - rider.at, why: `for the steepest part of ${climb.name ?? "the climb"} (${(bestGrade * 100).toFixed(1)}%)` };
  }

  if (code === "STEAMROLLER" || code === "ANVIL") {
    // The top of the next real descent: 200 m at -3% or steeper.
    for (let d = 0; d < LOOK_M; d += 25) {
      if (gradeBetween(route, rider.at + d, rider.at + d + 200) <= -0.03) return { inM: d, why: "from the top of the descent" };
    }
    return { why: "Save it for the next descent." };
  }

  if (code === "NINJA") return { why: "Use it to attack from the back of the group - the riders around can't see you go." };
  return undefined;
}
