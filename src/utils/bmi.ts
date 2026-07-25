// Matches the fuzzy lookup useTrendsData.ts already uses to find a weight
// entry in the Apple Health catalog, since the exact field name varies by
// export source (e.g. "weight_body_mass" vs "body_mass").
const WEIGHT_NAME_PATTERN = /weight|body_mass/i;

export function findWeightMetricName(catalog: { name: string }[]): string | null {
  return catalog.find((entry) => WEIGHT_NAME_PATTERN.test(entry.name))?.name ?? null;
}

// MetricDef ids for Apple Health entries are "health.<catalog name>" (see
// useDashboardData.ts) - strips that prefix before testing.
export function isWeightMetricId(metricId: string): boolean {
  return WEIGHT_NAME_PATTERN.test(metricId.replace(/^health\./, ""));
}

export function computeBmi(weightKg: number, heightCm: number): number {
  const heightM = heightCm / 100;
  return Math.round((weightKg / (heightM * heightM)) * 10) / 10;
}

// Standard WHO BMI classification bands, matching a typical clinical BMI
// chart (underweight/healthy/overweight/obese/extremely obese) - the single
// source of truth for both the BMI widget's own chart and anything else
// (e.g. the weight widget) that colors itself by the current BMI category.
export const BMI_DOMAIN_MIN = 15;
export const BMI_DOMAIN_MAX = 45;

export type BmiBand = { label: string; max: number; color: string };

export const BMI_BANDS: BmiBand[] = [
  { label: "Underweight", max: 18.5, color: "#f4d35e" },
  { label: "Healthy", max: 25, color: "var(--color-accent-2)" },
  { label: "Overweight", max: 30, color: "var(--color-amber)" },
  { label: "Obese", max: 40, color: "var(--color-accent)" },
  { label: "Extremely obese", max: BMI_DOMAIN_MAX, color: "#8b1e1e" },
];

export function bmiCategory(bmi: number): BmiBand {
  return BMI_BANDS.find((band) => bmi < band.max) ?? BMI_BANDS[BMI_BANDS.length - 1];
}

export function bmiCategoryColor(bmi: number): string {
  return bmiCategory(bmi).color;
}
