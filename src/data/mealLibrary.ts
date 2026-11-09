import { PLANS, type CategoryId, type Ingredient, type Meal } from "./mealPlan";
import { LIZETTE_DAILY, LIZETTE_MEALS, LIZETTE_TARGETS } from "./mealPlanLizette";

// Every meal from every plan - Malcolm's original and newer plans and
// Lizette's - in one library, each portioned for whoever's eating it: its
// ingredients scaled to that person's calorie target for the category
// (Malcolm's from the plan he's following, Lizette's from hers). So her
// prawns can be his dinner at 500 kcal, and his salmon pasta hers at 300.

export type Person = "malcolm" | "lizette";
export const PEOPLE: { id: Person; name: string }[] = [
  { id: "malcolm", name: "Malcolm" },
  { id: "lizette", name: "Lizette" },
];

export interface LibraryMeal extends Meal {
  /** Whose plan it came from. */
  source: string;
}

const CATEGORY_IDS: CategoryId[] = ["post", "breakfast", "lunch", "snack", "dinner"];
export const CATEGORY_NAMES: Record<CategoryId, string> = PLANS[0].categories.reduce(
  (acc, c) => ({ ...acc, [c.id]: c.name }),
  {} as Record<CategoryId, string>,
);

const from = (planId: string, cat: CategoryId, source: string): LibraryMeal[] =>
  (PLANS.find((p) => p.id === planId)?.categories.find((c) => c.id === cat)?.meals ?? []).map((m) => ({ ...m, source }));

/** The meals to choose from in each category, grouped by whose plan they're from. */
export const LIBRARY: Record<CategoryId, LibraryMeal[]> = Object.fromEntries(
  CATEGORY_IDS.map((cat) => [
    cat,
    [
      ...from("original", cat, "Malcolm's original plan"),
      ...from("new-2400", cat, "Malcolm's new plan"),
      ...(LIZETTE_MEALS[cat] ?? []).map((m) => ({ ...m, source: "Lizette's plan" })),
    ],
  ]),
) as Record<CategoryId, LibraryMeal[]>;

/** The newer plan's 2550 meals are its 2400 meals, portioned bigger - one meal, two sizes. */
export const canonicalId = (id: string) => id.replace(/^n2550:/, "n2400:");

const byId = new Map<string, { meal: LibraryMeal; cat: CategoryId }>(
  CATEGORY_IDS.flatMap((cat) => LIBRARY[cat].map((meal) => [meal.id, { meal, cat }] as [string, { meal: LibraryMeal; cat: CategoryId }])),
);
export const libraryMeal = (id: string | null | undefined) => (id ? byId.get(canonicalId(id))?.meal : undefined);
export const mealCategory = (id: string) => byId.get(canonicalId(id))?.cat;

/** A person's calorie target for a category: Malcolm's from his plan, Lizette's from hers. */
export function targetFor(person: Person, planId: string, cat: CategoryId): number {
  if (person === "lizette") return LIZETTE_TARGETS[cat];
  const plan = PLANS.find((p) => p.id === planId) ?? PLANS[0];
  return plan.categories.find((c) => c.id === cat)?.kcal ?? 0;
}

export function dailyFor(person: Person, planId: string) {
  return person === "lizette" ? LIZETTE_DAILY : (PLANS.find((p) => p.id === planId) ?? PLANS[0]).daily;
}

/** Grams rounded the way they'd be weighed: to the gram when small, to 5 g otherwise. */
const roundG = (g: number) => (g < 20 ? Math.max(1, Math.round(g)) : Math.round(g / 5) * 5);

/** A meal portioned to a calorie target - every ingredient, and its macros, scaled to match. */
export function portion(meal: Meal, kcal: number): Meal {
  if (!meal.kcal || !kcal) return meal;
  const f = kcal / meal.kcal;
  if (Math.abs(f - 1) < 0.01) return meal;
  const scale = (v?: number) => (v == null ? v : Math.round(v * f));
  return {
    ...meal,
    kcal: Math.round(kcal),
    protein: scale(meal.protein),
    carbs: scale(meal.carbs),
    fat: scale(meal.fat),
    ingredients: meal.ingredients.map((i): Ingredient => (i.g ? { ...i, g: roundG(i.g * f) } : i)),
  };
}
