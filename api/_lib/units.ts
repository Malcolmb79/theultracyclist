export type UnitSystem = "metric" | "imperial";

/**
 * Server-side twin of src/utils/units.ts.
 *
 * Kept as its own copy rather than imported across the frontend/api boundary,
 * matching how the rest of this project keeps those two TypeScript projects
 * decoupled - but the factors and the unit names must stay identical to that
 * file, or the coach and the dashboard will quote different numbers for the
 * same reading.
 *
 * Apple Health stores each field in whichever unit the athlete's device uses,
 * so a stored record is a mix: pounds for body weight, miles for cycling
 * distance, US fluid ounces for water. Anything that reads those has to
 * convert into the athlete's chosen system rather than repeating the stored
 * unit back at them.
 */

const KM_TO_MI = 0.621371;
const M_TO_FT = 3.28084;
const KG_TO_LB = 2.20462;
const L_TO_FL_OZ_US = 33.814;

export function convertValueUnit(value: number, unit: string, system: UnitSystem): { value: number; unit: string } {
  const u = unit.trim().toLowerCase();

  if (system === "imperial") {
    if (u === "km") return { value: value * KM_TO_MI, unit: "mi" };
    if (u === "m") return { value: value * M_TO_FT, unit: "ft" };
    if (u === "kg") return { value: value * KG_TO_LB, unit: "lb" };
    if (u === "km/h") return { value: value * KM_TO_MI, unit: "mph" };
    if (u === "l") return { value: value * L_TO_FL_OZ_US, unit: "fl_oz_us" };
    if (u === "ml") return { value: (value / 1000) * L_TO_FL_OZ_US, unit: "fl_oz_us" };
    return { value, unit };
  }

  if (u === "mi") return { value: value / KM_TO_MI, unit: "km" };
  if (u === "ft") return { value: value / M_TO_FT, unit: "m" };
  if (u === "lb" || u === "lbs") return { value: value / KG_TO_LB, unit: "kg" };
  if (u === "mi/hr" || u === "mph") return { value: value / KM_TO_MI, unit: "km/h" };
  if (u === "fl_oz_us") return { value: (value / L_TO_FL_OZ_US) * 1000, unit: "ml" };
  return { value, unit };
}

/**
 * Converts a day-keyed health record in place of its stored units.
 *
 * Rounded to two decimals: these figures are read aloud by the coach, and a
 * raw 72.03649... kg reads as false precision.
 */
export function convertHealthHistory<T extends Record<string, Record<string, { value: number; unit: string }>>>(
  history: T,
  system: UnitSystem,
): T {
  const out: Record<string, Record<string, { value: number; unit: string }>> = {};
  for (const [date, day] of Object.entries(history)) {
    const converted: Record<string, { value: number; unit: string }> = {};
    for (const [name, reading] of Object.entries(day)) {
      const next = convertValueUnit(reading.value, reading.unit, system);
      converted[name] = { value: Math.round(next.value * 100) / 100, unit: next.unit };
    }
    out[date] = converted;
  }
  return out as T;
}
