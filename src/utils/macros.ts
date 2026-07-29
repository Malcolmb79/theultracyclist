// Atwater factors: the energy each macronutrient carries per gram. The split
// widget compares macros as a share of the day's *energy*, not as a share of
// total grams - 27g of fat is a bigger part of the day than 27g of carbs, and
// a by-weight split would say otherwise.
export const KCAL_PER_G = { carbs: 4, fat: 9, protein: 4 } as const;

export type MacroKey = keyof typeof KCAL_PER_G;

// Fixed slot order, never cycled: carbohydrates, fat, protein. The colours
// are a categorical set (identity, not status) chosen so no pair collapses
// under protanopia/deuteranopia and every one clears 3:1 against both the
// dark and light card surfaces - deliberately NOT the app's amber/red
// accents, which mean "goal missed" everywhere else and would read as a
// verdict on the macro rather than a label for it.
export const MACRO_ORDER: MacroKey[] = ["carbs", "fat", "protein"];

export const MACRO_COLORS: Record<MacroKey, string> = {
  carbs: "#5b8def",
  fat: "#c9781f",
  protein: "#12a37c",
};

export const MACRO_LABELS: Record<MacroKey, string> = {
  carbs: "Carbohydrates",
  fat: "Fat",
  protein: "Protein",
};

export type MacroGrams = Record<MacroKey, number | null>;

// The exact Apple Health field name for a nutrient varies by whichever app
// wrote it, so each macro is matched by pattern, most specific first - the
// same list useTrendsData already uses for its per-macro goal widgets, kept
// here so the dashboard and Trends can't drift apart on what counts as fat.
export const MACRO_FIELD_PATTERNS: Record<MacroKey, RegExp[]> = {
  carbs: [/carbohydrate/i],
  fat: [/^total_fat$/i, /fat/i],
  protein: [/^protein$/i],
};

export function findMacroField(catalog: { name: string }[], key: MacroKey): string | null {
  for (const pattern of MACRO_FIELD_PATTERNS[key]) {
    const match = catalog.find((c) => pattern.test(c.name));
    if (match) return match.name;
  }
  return null;
}

// Dashboard MetricDef ids for Apple Health entries are "health.<catalog
// name>" (see useDashboardData.ts) - strips that prefix before matching, the
// same way bmi.ts's isWeightMetricId does.
export function findMacroMetricId(metricIds: string[], key: MacroKey): string | null {
  for (const pattern of MACRO_FIELD_PATTERNS[key]) {
    const match = metricIds.find((id) => pattern.test(id.replace(/^health\./, "")));
    if (match) return match;
  }
  return null;
}

export type MacroShare = {
  key: MacroKey;
  grams: number | null;
  kcal: number;
  /** Share of the day's energy, 0-100, or null with nothing logged. */
  percent: number | null;
  /** The same share computed from the goal grams, for side-by-side reading. */
  goalPercent: number | null;
};

function percentages(grams: MacroGrams): Record<MacroKey, number | null> {
  const kcal = MACRO_ORDER.map((key) => (grams[key] ?? 0) * KCAL_PER_G[key]);
  const total = kcal.reduce((a, b) => a + b, 0);
  const out = {} as Record<MacroKey, number | null>;
  MACRO_ORDER.forEach((key, i) => {
    out[key] = total > 0 ? (kcal[i] / total) * 100 : null;
  });
  return out;
}

// A goal share is only meaningful when all three targets are set - two out of
// three would silently renormalise to 100% and show a protein goal of 58%
// when the athlete set 40%.
export function macroShares(grams: MacroGrams, goals: MacroGrams): MacroShare[] {
  const actual = percentages(grams);
  const goalsComplete = MACRO_ORDER.every((key) => goals[key] != null && (goals[key] as number) > 0);
  const goal = goalsComplete ? percentages(goals) : null;

  return MACRO_ORDER.map((key) => ({
    key,
    grams: grams[key],
    kcal: (grams[key] ?? 0) * KCAL_PER_G[key],
    percent: actual[key],
    goalPercent: goal ? goal[key] : null,
  }));
}

export function totalKcal(grams: MacroGrams): number {
  return MACRO_ORDER.reduce((sum, key) => sum + (grams[key] ?? 0) * KCAL_PER_G[key], 0);
}
