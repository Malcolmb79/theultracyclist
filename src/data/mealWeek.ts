import { PLANS, REST_DAYS, SECTIONS, type CategoryId, type Meal, type Plan, type Section } from "./mealPlan.js";
import { libraryMeal, portion, targetFor, type Person } from "./mealLibrary.js";

// The week's meal plan worked out from what's been chosen: who's eating each
// day, each meal portioned for each of them, their day totals and the
// shopping list. Shared by the Meals page and the site's meal-plan route,
// which hands the same view to a read-only AI agent - so what the agent reads
// is exactly what the page shows. No React here.

export const DAYS = [
  { id: "mon", name: "Monday" },
  { id: "tue", name: "Tuesday" },
  { id: "wed", name: "Wednesday" },
  { id: "thu", name: "Thursday" },
  { id: "fri", name: "Friday" },
  { id: "sat", name: "Saturday" },
  { id: "sun", name: "Sunday" },
] as const;

export type Week = {
  days: Record<string, Partial<Record<CategoryId, string | null>>>;
  checked: string[];
  startedOn?: string;
  plan?: string;
  dayPlan?: Record<string, string>;
  training?: Record<string, boolean>;
  fast?: Record<string, boolean>;
  /** Each person's training and fasting days, where set apart from the day's (above). */
  trainingBy?: Partial<Record<Person, Record<string, boolean>>>;
  fastBy?: Partial<Record<Person, Record<string, boolean>>>;
  who?: Record<string, "both" | Person>;
  /** Malcolm's kcal on training days (older weeks); 0 for his plan's own. */
  trainingKcal?: number;
  /** Each person's day totals on rest and training days, where chosen. */
  kcal?: Partial<Record<Person, { rest?: number; training?: number }>>;
};

/** Malcolm's training-day total when nothing's been chosen - he asked for 2200. */
export const DEFAULT_MALCOLM_TRAINING = 2200;
/** The sliders' ranges. */
export const KCAL_RANGE: Record<Person, [number, number]> = { malcolm: [1500, 3500], lizette: [1000, 2500] };

/** A person's plan targets for each category, on a day (Malcolm's from the plan he's following). */
export const planTargets = (w: Week, day: string, person: Person) =>
  Object.fromEntries(CATEGORIES.map((c) => [c, targetFor(person, dayPlanOf(w, day).id, c)])) as Record<CategoryId, number>;

/** What the plan itself gives a person on a rest day and on a training day. */
export function planDay(w: Week, day: string, person: Person) {
  const t = planTargets(w, day, person);
  const all = CATEGORIES.reduce((a, c) => a + t[c], 0);
  return { rest: all - t.post, training: all };
}

/** A person's day total, kcal: the slider's, else the plan's (Malcolm's training days 2200 unless set). */
export function dayKcal(w: Week, day: string, person: Person): number {
  const training = isTraining(w, day, person);
  const chosen = w.kcal?.[person]?.[training ? "training" : "rest"];
  if (chosen) return chosen;
  if (person === "malcolm" && training) {
    if (w.trainingKcal === 0) return planDay(w, day, person).training;
    return w.trainingKcal ?? DEFAULT_MALCOLM_TRAINING;
  }
  return planDay(w, day, person)[training ? "training" : "rest"];
}

export const CATEGORIES: CategoryId[] = ["post", "breakfast", "lunch", "snack", "dinner"];
/** Who's eating a day: both by default. */
export const eaters = (w: Week, day: string): Person[] => {
  const who = w.who?.[day] ?? "both";
  return who === "both" ? ["malcolm", "lizette"] : [who];
};

export const planById = new Map(PLANS.map((p) => [p.id, p]));

export const weekPlan = (w: Week): Plan => planById.get(w.plan ?? "") ?? PLANS[0];
export const dayPlanOf = (w: Week, day: string): Plan => planById.get(w.dayPlan?.[day] ?? "") ?? weekPlan(w);
/**
 * A person's training day - from the exercise plan (rest on Thursday and
 * Sunday) unless switched, for them or (in older weeks) for the day.
 */
export const isTraining = (w: Week, day: string, person: Person) => w.trainingBy?.[person]?.[day] ?? w.training?.[day] ?? !REST_DAYS.has(day);
export const isFasting = (w: Week, day: string, person: Person) => w.fastBy?.[person]?.[day] ?? !!w.fast?.[day];
/** Whether a category is on for a person on a day: no post-workout snack on a rest day, no breakfast on a fasting day. */
export const isOn = (w: Week, day: string, cat: CategoryId, person: Person) =>
  cat === "post" ? isTraining(w, day, person) : cat === "breakfast" ? !isFasting(w, day, person) : true;

/** The day's chosen meals, and who of the day's eaters each one is on for. */
export function dayMeals(w: Week, day: string): { cat: CategoryId; meal: Meal; for: Person[] }[] {
  const out: { cat: CategoryId; meal: Meal; for: Person[] }[] = [];
  for (const cat of CATEGORIES) {
    const who = eaters(w, day).filter((p) => isOn(w, day, cat, p));
    if (!who.length) continue;
    const m = libraryMeal(w.days[day]?.[cat]);
    if (m) out.push({ cat, meal: m, for: who });
  }
  return out;
}

/**
 * How much a person's plan targets are scaled on a day: so the day's meals
 * add up to their day total (rest or training), each meal keeping its share.
 * Fasting takes breakfast's share away rather than spreading it over the rest.
 */
export function scaleFor(w: Week, day: string, person: Person): number {
  const t = planTargets(w, day, person);
  const planned = CATEGORIES.filter((c) => c !== "post" || isTraining(w, day, person)).reduce((a, c) => a + t[c], 0);
  return planned ? dayKcal(w, day, person) / planned : 1;
}

/** A person's target for one of the day's meals. */
export const dayTarget = (w: Week, day: string, person: Person, cat: CategoryId) =>
  Math.round(targetFor(person, dayPlanOf(w, day).id, cat) * scaleFor(w, day, person));

/** A day's meal as one person eats it. */
export const servedTo = (w: Week, day: string, person: Person, cat: CategoryId, meal: Meal) => portion(meal, dayTarget(w, day, person, cat));

export function amount(g: number): string {
  return g >= 1000 ? `${(g / 1000).toFixed(g >= 10_000 ? 1 : 2).replace(/\.?0+$/, "")} kg` : `${Math.round(g)} g`;
}

export interface Line {
  item: string;
  section: Section;
  g: number;
  servings: number;
  as: Set<string>;
  amounts: Set<string>;
}

/** Everything the week's meals need, added up by shopping item. */
export function shoppingList(week: Week): Map<Section, Line[]> {
  const lines = new Map<string, Line>();
  for (const d of DAYS) {
    for (const { cat, meal: base, for: people } of dayMeals(week, d.id)) for (const person of people) {
      const meal = servedTo(week, d.id, person, cat, base);
      for (const ing of meal.ingredients) {
        let l = lines.get(ing.item);
        if (!l) {
          l = { item: ing.item, section: ing.section, g: 0, servings: 0, as: new Set(), amounts: new Set() };
          lines.set(ing.item, l);
        }
        l.servings++;
        if (ing.g) l.g += ing.g;
        if (ing.as) l.as.add(ing.as);
        if (ing.amount) l.amounts.add(ing.amount);
      }
    }
  }
  const bySection = new Map<Section, Line[]>();
  for (const s of SECTIONS) {
    const ls = [...lines.values()].filter((l) => l.section === s).sort((a, b) => a.item.localeCompare(b.item));
    if (ls.length) bySection.set(s, ls);
  }
  return bySection;
}

export function lineText(l: Line): string {
  const qty = l.g ? amount(l.g) : [...l.amounts].join(" / ") || "to taste";
  const as = l.as.size === 1 ? ` (${[...l.as][0]})` : "";
  return `${l.item}${as} - ${qty}`;
}

/** Each eater's totals for the day, and their target: their plan's, less the categories that are off. */
export function dayTotals(w: Week, day: string) {
  return eaters(w, day).map((person) => {
    const meals = dayMeals(w, day)
      .filter((m) => m.for.includes(person))
      .map(({ cat, meal }) => servedTo(w, day, person, cat, meal));
    const target = CATEGORIES.filter((c) => isOn(w, day, c, person)).reduce((a, c) => a + dayTarget(w, day, person, c), 0);
    return {
      person,
      kcal: meals.reduce((a, m) => a + (m.kcal ?? 0), 0),
      protein: meals.reduce((a, m) => a + (m.protein ?? 0), 0),
      target,
    };
  });
}


const personName = (p: Person) => (p === "malcolm" ? "Malcolm" : "Lizette");
const CATEGORY_LABELS: Record<CategoryId, string> = { post: "Post-workout snack", breakfast: "Breakfast", lunch: "Lunch", snack: "Snack", dinner: "Dinner" };

/**
 * The week as the Meals page shows it, in words and numbers: each day's
 * eaters, training and fasting, every meal portioned for each person with its
 * ingredients and method, the day totals against target, and the shopping
 * list with what's ticked. What the site hands a read-only AI agent.
 */
export function readableWeek(input: Partial<Week>) {
  const w: Week = { ...input, days: input.days ?? {}, checked: input.checked ?? [] };
  return {
    startedOn: w.startedOn ?? null,
    days: DAYS.map((d) => {
      const who = eaters(w, d.id);
      const totals = dayTotals(w, d.id);
      return {
        day: d.name,
        plan: dayPlanOf(w, d.id).name,
        eating: who.map(personName),
        people: who.map((p) => {
          const t = totals.find((x) => x.person === p)!;
          return { person: personName(p), training: isTraining(w, d.id, p), fasting: isFasting(w, d.id, p), kcal: t.kcal, proteinG: t.protein, targetKcal: t.target };
        }),
        meals: CATEGORIES.map((cat) => {
          const onFor = who.filter((p) => isOn(w, d.id, cat, p));
          if (!onFor.length) return { category: CATEGORY_LABELS[cat], skipped: cat === "post" ? "rest day" : "fasting" };
          const chosen = libraryMeal(w.days[d.id]?.[cat]);
          if (!chosen) return { category: CATEGORY_LABELS[cat], meal: null, for: onFor.map(personName) };
          return {
            category: CATEGORY_LABELS[cat],
            meal: chosen.name,
            for: onFor.map(personName),
            prepMin: chosen.prepMin,
            cookMin: chosen.cookMin,
            portions: onFor.map((p) => {
              const m = servedTo(w, d.id, p, cat, chosen);
              return {
                person: personName(p),
                kcal: m.kcal,
                proteinG: m.protein,
                carbsG: m.carbs,
                fatG: m.fat,
                ingredients: m.ingredients.map((i) => `${i.item}${i.as ? ` (${i.as})` : ""} - ${i.g ? amount(i.g) : (i.amount ?? "to taste")}`),
              };
            }),
            method: chosen.method ?? [],
          };
        }),
      };
    }),
    shoppingList: [...shoppingList(w)].map(([section, lines]) => ({
      section,
      items: lines.map((l) => ({ item: lineText(l), ticked: w.checked.includes(l.item) })),
    })),
  };
}
