import type { RouteGeometry } from "../components/race/courseMap";
import { elevationAt } from "./climb";

// Riding physics, for working out speed on the road ahead: the power that
// goes into air drag, rolling resistance and climbing. The drag figure is
// calibrated from what the rider is actually doing - their speed for their
// power - so it takes in their draft, their bike and Zwift's own physics
// without needing to know any of them.

const G = 9.81;
const RHO = 1.2;
const CRR = 0.004;
/** Bike and kit on top of the rider's weight. */
export const BIKE_KG = 8;

function resist(grade: number, massKg: number): number {
  const theta = Math.atan(grade);
  return massKg * G * (Math.sin(theta) + CRR * Math.cos(theta));
}

/** Watts needed to hold a speed (m/s) on a gradient (fraction). */
export function powerFor(v: number, grade: number, massKg: number, cdA: number): number {
  return 0.5 * RHO * cdA * v ** 3 + resist(grade, massKg) * v;
}

/** The speed (m/s) a power holds on a gradient - by bisection, since power rises steadily with speed. */
export function speedFor(watts: number, grade: number, massKg: number, cdA: number): number {
  let lo = 0.5;
  let hi = 30;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (powerFor(mid, grade, massKg, cdA) > watts) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/**
 * The drag figure (CdA) that explains a speed for a power on a gradient -
 * the rider's real one, draft and all. Kept to a sensible range, and
 * undefined when the numbers can't tell (too slow, or coasting).
 */
export function calibrateCdA(watts: number, kmh: number, grade: number, massKg: number): number | undefined {
  const v = kmh / 3.6;
  if (v < 5 || watts < 40) return undefined;
  const cdA = (watts / v - resist(grade, massKg)) / (0.5 * RHO * v * v);
  return Number.isFinite(cdA) ? Math.max(0.08, Math.min(0.6, cdA)) : undefined;
}

/** A place along the route as many laps on as it likes, folded back onto the route's one lap. */
export function wrapRoute(route: RouteGeometry, d: number): number {
  const total = route.distances.at(-1) ?? 0;
  return d <= total || route.lapM <= 0 ? d : route.leadinM + ((d - route.leadinM) % route.lapM);
}

/** The gradient (fraction) over a stretch of the route, laps and all. */
export function gradeBetween(route: RouteGeometry, a: number, b: number): number {
  return b > a ? (elevationAt(route, wrapRoute(route, b)) - elevationAt(route, wrapRoute(route, a))) / (b - a) : 0;
}

/**
 * Seconds to ride from `from` for `metres` along the route at a steady
 * power, slice by slice of road.
 */
export function timeAhead(route: RouteGeometry, from: number, metres: number, watts: number, massKg: number, cdA: number, slice = 50): number {
  let t = 0;
  for (let d = 0; d < metres; d += slice) {
    const len = Math.min(slice, metres - d);
    const v = speedFor(watts, gradeBetween(route, from + d, from + d + len), massKg, cdA);
    t += len / Math.max(1.5, v);
  }
  return t;
}
