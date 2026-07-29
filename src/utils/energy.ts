// Apple Health's energy fields, matched by pattern because the exact name
// varies by whichever app wrote them.
export const ENERGY_FIELD_PATTERNS = {
  consumed: /dietary_energy/i,
  active: /active_energy/i,
  basal: /basal_energy|resting_energy/i,
} as const;

export type EnergyKind = keyof typeof ENERGY_FIELD_PATTERNS;

export type EnergyTotals = { consumed: number | null; burned: number | null };

// Which fields add up to "burned" is deliberately a parameter, because the
// two callers disagree: the Dashboard's daily card counts active + basal
// (the full day's expenditure, BMR included), while the Trends card counts
// active only, as asked for - the two widgets it replaces were Active
// Energy and Dietary Energy. Excluding basal makes Net read far more
// positive, since BMR is the largest single term in a day.
export const BURNED_ACTIVE_ONLY: EnergyKind[] = ["active"];
export const BURNED_ACTIVE_PLUS_BASAL: EnergyKind[] = ["active", "basal"];

// Dashboard/Trends MetricDef ids for Apple Health entries are
// "health.<catalog name>" - the prefix is stripped before matching, the same
// way bmi.ts and macros.ts do it.
export function isEnergyMetricId(metricId: string, kind: EnergyKind): boolean {
  return ENERGY_FIELD_PATTERNS[kind].test(metricId.replace(/^health\./, ""));
}

// Adds consumed and burned across a set of dates, so the same card can show
// one day or a whole month. A side with no readings anywhere in the range
// stays null, so the card shows "—" rather than a confident 0 - but a day
// missing one of the burned components still counts the others.
export function sumEnergy(
  dates: string[],
  valueFor: (date: string, kind: EnergyKind) => number | null,
  burnedKinds: EnergyKind[] = BURNED_ACTIVE_PLUS_BASAL,
): EnergyTotals {
  let consumed: number | null = null;
  let burned: number | null = null;

  for (const date of dates) {
    const dayConsumed = valueFor(date, "consumed");
    if (dayConsumed != null) consumed = (consumed ?? 0) + dayConsumed;

    const parts = burnedKinds.map((kind) => valueFor(date, kind));
    if (parts.some((v) => v != null)) {
      const dayBurned = parts.reduce<number>((sum, v) => sum + (v ?? 0), 0);
      burned = (burned ?? 0) + dayBurned;
    }
  }

  return { consumed, burned };
}
