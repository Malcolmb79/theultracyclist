// Matches the fuzzy lookup useTrendsData.ts already uses to find a weight
// entry in the Apple Health catalog, since the exact field name varies by
// export source (e.g. "weight_body_mass" vs "body_mass").
const WEIGHT_NAME_PATTERN = /weight|body_mass/i;

export function findWeightMetricName(catalog: { name: string }[]): string | null {
  return catalog.find((entry) => WEIGHT_NAME_PATTERN.test(entry.name))?.name ?? null;
}

export function computeBmi(weightKg: number, heightCm: number): number {
  const heightM = heightCm / 100;
  return Math.round((weightKg / (heightM * heightM)) * 10) / 10;
}
