import { useEffect, useMemo, useRef, useState } from "react";
import { useAuthSession } from "../utils/useAuthSession";
import { useDashboardTheme } from "../utils/useDashboardTheme";
import SignInGate from "../components/shared/SignInGate";
import TabNav from "../components/shared/TabNav";
import PageHeader from "../components/shared/PageHeader";
import ProfileMenu from "../components/shared/ProfileMenu";
import { PLANS, REST_DAYS, SECTIONS, type CategoryId, type Meal, type Plan, type Section } from "../data/mealPlan";
import { CATEGORY_NAMES, LIBRARY, PEOPLE, libraryMeal, portion, targetFor, type Person } from "../data/mealLibrary";
import styles from "./MealsPage.module.css";

// The meal plan as a week, for Malcolm and Lizette: for each day, who's
// eating, the plan Malcolm follows, whether it's a training day (the
// post-workout snack) and whether it's a fasting day (no breakfast), and a
// meal from each category that's on - any meal from either of their plans,
// portioned for each of them (see ../data/mealLibrary). The shopping list
// adds up every ingredient across the week, grouped by where it is in the
// shop, to tick off as it goes in the trolley. All of it is kept on the site
// (api/_routes/meal-plan.ts), so it's the same on the phone in the shop as
// on the computer that planned it.

const DAYS = [
  { id: "mon", name: "Monday" },
  { id: "tue", name: "Tuesday" },
  { id: "wed", name: "Wednesday" },
  { id: "thu", name: "Thursday" },
  { id: "fri", name: "Friday" },
  { id: "sat", name: "Saturday" },
  { id: "sun", name: "Sunday" },
] as const;

type Week = {
  days: Record<string, Partial<Record<CategoryId, string | null>>>;
  checked: string[];
  startedOn?: string;
  plan?: string;
  dayPlan?: Record<string, string>;
  training?: Record<string, boolean>;
  fast?: Record<string, boolean>;
  who?: Record<string, "both" | Person>;
  /** Malcolm's kcal on training days (older weeks); 0 for his plan's own. */
  trainingKcal?: number;
  /** Each person's day totals on rest and training days, where chosen. */
  kcal?: Partial<Record<Person, { rest?: number; training?: number }>>;
};

/** Malcolm's training-day total when nothing's been chosen - he asked for 2200. */
const DEFAULT_MALCOLM_TRAINING = 2200;
/** The sliders' ranges. */
const KCAL_RANGE: Record<Person, [number, number]> = { malcolm: [1500, 3500], lizette: [1000, 2500] };

/** A person's plan targets for each category, on a day (Malcolm's from the plan he's following). */
const planTargets = (w: Week, day: string, person: Person) =>
  Object.fromEntries(CATEGORIES.map((c) => [c, targetFor(person, dayPlanOf(w, day).id, c)])) as Record<CategoryId, number>;

/** What the plan itself gives a person on a rest day and on a training day. */
function planDay(w: Week, day: string, person: Person) {
  const t = planTargets(w, day, person);
  const all = CATEGORIES.reduce((a, c) => a + t[c], 0);
  return { rest: all - t.post, training: all };
}

/** A person's day total, kcal: the slider's, else the plan's (Malcolm's training days 2200 unless set). */
function dayKcal(w: Week, day: string, person: Person): number {
  const training = isTraining(w, day);
  const chosen = w.kcal?.[person]?.[training ? "training" : "rest"];
  if (chosen) return chosen;
  if (person === "malcolm" && training) {
    if (w.trainingKcal === 0) return planDay(w, day, person).training;
    return w.trainingKcal ?? DEFAULT_MALCOLM_TRAINING;
  }
  return planDay(w, day, person)[training ? "training" : "rest"];
}

const CATEGORIES: CategoryId[] = ["post", "breakfast", "lunch", "snack", "dinner"];
/** Who's eating a day: both by default. */
const eaters = (w: Week, day: string): Person[] => {
  const who = w.who?.[day] ?? "both";
  return who === "both" ? ["malcolm", "lizette"] : [who];
};

const planById = new Map(PLANS.map((p) => [p.id, p]));

const weekPlan = (w: Week): Plan => planById.get(w.plan ?? "") ?? PLANS[0];
const dayPlanOf = (w: Week, day: string): Plan => planById.get(w.dayPlan?.[day] ?? "") ?? weekPlan(w);
/** A training day - from the exercise plan (rest on Thursday and Sunday) unless switched. */
const isTraining = (w: Week, day: string) => w.training?.[day] ?? !REST_DAYS.has(day);
const isFasting = (w: Week, day: string) => !!w.fast?.[day];
/** Whether a category is on for a day: no post-workout snack on a rest day, no breakfast on a fasting day. */
const isOn = (w: Week, day: string, cat: CategoryId) => (cat === "post" ? isTraining(w, day) : cat === "breakfast" ? !isFasting(w, day) : true);

/** The day's chosen meals that count: for categories that are on. */
function dayMeals(w: Week, day: string): { cat: CategoryId; meal: Meal }[] {
  const out: { cat: CategoryId; meal: Meal }[] = [];
  for (const cat of CATEGORIES) {
    if (!isOn(w, day, cat)) continue;
    const m = libraryMeal(w.days[day]?.[cat]);
    if (m) out.push({ cat, meal: m });
  }
  return out;
}

/**
 * How much a person's plan targets are scaled on a day: so the day's meals
 * add up to their day total (rest or training), each meal keeping its share.
 * Fasting takes breakfast's share away rather than spreading it over the rest.
 */
function scaleFor(w: Week, day: string, person: Person): number {
  const t = planTargets(w, day, person);
  const planned = CATEGORIES.filter((c) => c !== "post" || isTraining(w, day)).reduce((a, c) => a + t[c], 0);
  return planned ? dayKcal(w, day, person) / planned : 1;
}

/** A person's target for one of the day's meals. */
const dayTarget = (w: Week, day: string, person: Person, cat: CategoryId) =>
  Math.round(targetFor(person, dayPlanOf(w, day).id, cat) * scaleFor(w, day, person));

/** A day's meal as one person eats it. */
const servedTo = (w: Week, day: string, person: Person, cat: CategoryId, meal: Meal) => portion(meal, dayTarget(w, day, person, cat));

function amount(g: number): string {
  return g >= 1000 ? `${(g / 1000).toFixed(g >= 10_000 ? 1 : 2).replace(/\.?0+$/, "")} kg` : `${Math.round(g)} g`;
}

interface Line {
  item: string;
  section: Section;
  g: number;
  servings: number;
  as: Set<string>;
  amounts: Set<string>;
}

/** Everything the week's meals need, added up by shopping item. */
function shoppingList(week: Week): Map<Section, Line[]> {
  const lines = new Map<string, Line>();
  for (const d of DAYS) {
    for (const { cat, meal: base } of dayMeals(week, d.id)) for (const person of eaters(week, d.id)) {
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

function lineText(l: Line): string {
  const qty = l.g ? amount(l.g) : [...l.amounts].join(" / ") || "to taste";
  const as = l.as.size === 1 ? ` (${[...l.as][0]})` : "";
  return `${l.item}${as} - ${qty}`;
}

/** Each eater's totals for the day, and their target: their plan's, less the categories that are off. */
function dayTotals(w: Week, day: string) {
  return eaters(w, day).map((person) => {
    const meals = dayMeals(w, day).map(({ cat, meal }) => servedTo(w, day, person, cat, meal));
    const target = CATEGORIES.filter((c) => isOn(w, day, c)).reduce((a, c) => a + dayTarget(w, day, person, c), 0);
    return {
      person,
      kcal: meals.reduce((a, m) => a + (m.kcal ?? 0), 0),
      protein: meals.reduce((a, m) => a + (m.protein ?? 0), 0),
      target,
    };
  });
}

/** A category's meals, grouped by whose plan they're from. */
function MealOptions({ cat }: { cat: CategoryId }) {
  const groups = [...new Set(LIBRARY[cat].map((m) => m.source))];
  return (
    <>
      {groups.map((g) => (
        <optgroup key={g} label={g}>
          {LIBRARY[cat]
            .filter((m) => m.source === g)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
        </optgroup>
      ))}
    </>
  );
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function MealsPage() {
  useDashboardTheme();
  const auth = useAuthSession();
  const [week, setWeek] = useState<Week | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [viewPerson, setViewPerson] = useState<Person>("malcolm");

  useEffect(() => {
    if (auth.status !== "signed-in") return;
    fetch("/api/meal-plan")
      .then((r) => (r.ok ? (r.json() as Promise<{ week: Week }>) : Promise.reject(new Error(`Couldn't load (${r.status})`))))
      .then((a) => setWeek({ ...a.week, days: a.week.days ?? {}, checked: a.week.checked ?? [] }))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't load the week."));
  }, [auth.status]);

  // Saved a moment after each change.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const update = (next: Week) => {
    setWeek(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch("/api/meal-plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ week: next }) })
        .then((r) => setError(r.ok ? null : `Couldn't save (${r.status})`))
        .catch(() => setError("Couldn't save - check your connection."));
    }, 600);
  };

  const list = useMemo(() => (week ? shoppingList(week) : new Map<Section, Line[]>()), [week]);

  if (auth.status === "loading") {
    return (
      <div className={styles.page}>
        <p className={styles.loading}>Loading…</p>
      </div>
    );
  }
  if (auth.status === "signed-out") return <SignInGate title="Meals" />;

  const started = (w: Week): Week => ({ ...w, startedOn: w.startedOn ?? today() });
  const choose = (day: string, cat: CategoryId, id: string | null) =>
    week && update(started({ ...week, days: { ...week.days, [day]: { ...week.days[day], [cat]: id } } }));
  const setDay = (key: "training" | "fast", day: string, on: boolean) => week && update({ ...week, [key]: { ...week[key], [day]: on } });
  const setDayPlan = (day: string, planId: string) => week && update({ ...week, dayPlan: { ...week.dayPlan, [day]: planId } });
  const setWeekPlan = (planId: string) => week && update({ ...week, plan: planId, dayPlan: {} });
  /** Every day gets this meal (where the category is on). */
  const everyDay = (cat: CategoryId, id: string | null) =>
    week && update(started({ ...week, days: Object.fromEntries(DAYS.map((d) => [d.id, { ...week.days[d.id], [cat]: id }])) }));
  const tick = (item: string) =>
    week && update({ ...week, checked: week.checked.includes(item) ? week.checked.filter((x) => x !== item) : [...week.checked, item] });
  const newWeek = () => {
    if (week && window.confirm("Start a new week? This clears the week's meals and the ticks on the shopping list (your plan, training and fasting days stay).")) {
      update({ ...week, days: {}, checked: [], startedOn: today() });
    }
  };
  const copy = async () => {
    const text = [...list.entries()]
      .map(([section, ls]) => `${section}\n${ls.filter((l) => !week?.checked.includes(l.item)).map((l) => `- ${lineText(l)}`).join("\n")}`)
      .filter((block) => block.includes("\n- "))
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy - your browser blocked the clipboard.");
    }
  };
  const itemCount = [...list.values()].reduce((n, ls) => n + ls.length, 0);
  const ticked = week ? [...list.values()].flat().filter((l) => week.checked.includes(l.item)).length : 0;
  const setWho = (day: string, who: "both" | Person) => week && update({ ...week, who: { ...week.who, [day]: who } });

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <TabNav
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Trends", href: "/dashboard/trends" },
            { label: "Coaching", href: "/dashboard/coaching" },
            { label: "Meals", href: "/dashboard/meals", active: true },
            { label: "Race", href: "/dashboard/race" },
          ]}
          trailing={<ProfileMenu />}
        />
      </div>

      <PageHeader
        title="Meals"
        subtitle="Malcolm's and Lizette's meal plans as a week: one meal from each category a day - any meal from either plan, portioned for each of you - the post-workout snack only on training days, and breakfast off on fasting days. The shopping list adds it all up."
      />

      {error && <p className={styles.error}>{error}</p>}
      {!week ? (
        !error && <p className={styles.loading}>Loading your week…</p>
      ) : (
        <div className={styles.layout}>
          <section className={styles.card}>
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>This week</h2>
              <button type="button" className={styles.secondary} onClick={newWeek}>
                Start a new week
              </button>
            </div>
            <div className={styles.calories}>
              {PEOPLE.map((p) => {
                // The plan's own figures, from Monday's plan (the week's).
                const plan = planDay(week, "mon", p.id);
                const [lo, hi] = KCAL_RANGE[p.id];
                const value = (kind: "rest" | "training") =>
                  week.kcal?.[p.id]?.[kind] ??
                  (p.id === "malcolm" && kind === "training" && week.trainingKcal !== 0 ? (week.trainingKcal ?? DEFAULT_MALCOLM_TRAINING) : plan[kind]);
                const setKcal = (kind: "rest" | "training", v: number | undefined) =>
                  update({ ...week, kcal: { ...week.kcal, [p.id]: { ...week.kcal?.[p.id], [kind]: v } }, ...(p.id === "malcolm" && kind === "training" && v === undefined ? { trainingKcal: 0 } : {}) });
                return (
                  <div key={p.id} className={styles.person}>
                    <b>{p.name}</b>
                    {(["rest", "training"] as const).map((kind) => (
                      <label key={kind} className={styles.kcalRow}>
                        <span className={styles.kcalName}>{kind === "rest" ? "Rest days" : "Training days"}</span>
                        <input
                          type="range"
                          min={lo}
                          max={hi}
                          step={50}
                          value={value(kind)}
                          onChange={(e) => setKcal(kind, Number(e.target.value))}
                          aria-label={`${p.name}'s kcal on ${kind} days`}
                        />
                        <span className={styles.kcalValue}>{value(kind)} kcal</span>
                        <button
                          type="button"
                          className={styles.reset}
                          title={`Back to the plan's ${plan[kind]} kcal`}
                          onClick={() => setKcal(kind, undefined)}
                          disabled={value(kind) === plan[kind]}
                        >
                          Plan's
                        </button>
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>
            <div className={styles.everyDay}>
              <label className={styles.everyDayItem}>
                <b>Malcolm's plan</b>
                <select value={weekPlan(week).id} onChange={(e) => setWeekPlan(e.target.value)} aria-label="The week's plan">
                  {PLANS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <span className={styles.muted}>Same every day:</span>
              {CATEGORIES.map((cat) => (
                <label key={cat} className={styles.everyDayItem}>
                  <span>{CATEGORY_NAMES[cat]}</span>
                  <select value="" onChange={(e) => everyDay(cat, e.target.value === "none" ? null : e.target.value)} aria-label={`${CATEGORY_NAMES[cat]} every day`}>
                    <option value="">Choose…</option>
                    <MealOptions cat={cat} />
                    <option value="none">None</option>
                  </select>
                </label>
              ))}
            </div>
            <div className={styles.days}>
              {DAYS.map((d) => {
                const plan = dayPlanOf(week, d.id);
                const t = dayTotals(week, d.id);
                const training = isTraining(week, d.id);
                const fasting = isFasting(week, d.id);
                return (
                  <div key={d.id} className={`${styles.day} ${training ? styles.trainingDay : ""}`}>
                    <div className={styles.dayHead}>
                      <b>{d.name}</b>
                      <span className={styles.muted}>
                        {t.map((p) => (
                          <span key={p.person} className={styles.personTotal} title={`${PEOPLE.find((x) => x.id === p.person)!.name}: protein ${p.protein} g`}>
                            {p.person === "malcolm" ? "M" : "L"} {p.kcal}/{p.target}
                          </span>
                        ))}
                      </span>
                    </div>
                    <select className={styles.who} value={week.who?.[d.id] ?? "both"} onChange={(e) => setWho(d.id, e.target.value as "both" | Person)} aria-label={`Who's eating on ${d.name}`}>
                      <option value="both">Malcolm and Lizette</option>
                      <option value="malcolm">Malcolm only</option>
                      <option value="lizette">Lizette only</option>
                    </select>
                    <div className={styles.switches}>
                      <label className={`${styles.switch} ${training ? styles.on : ""}`}>
                        <input type="checkbox" checked={training} onChange={(e) => setDay("training", d.id, e.target.checked)} />
                        Training
                      </label>
                      <label className={`${styles.switch} ${fasting ? styles.on : ""}`}>
                        <input type="checkbox" checked={fasting} onChange={(e) => setDay("fast", d.id, e.target.checked)} />
                        Fasting
                      </label>
                      {PLANS.length > 1 && (
                        <select className={styles.dayPlan} value={plan.id} onChange={(e) => setDayPlan(d.id, e.target.value)} aria-label={`${d.name}'s plan`}>
                          {PLANS.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.short} kcal
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    {CATEGORIES.map((cat) => {
                      const on = isOn(week, d.id, cat);
                      const chosen = libraryMeal(week.days[d.id]?.[cat]);
                      return (
                        <label key={cat} className={`${styles.slot} ${on ? "" : styles.off}`}>
                          <span className={styles.slotName}>{CATEGORY_NAMES[cat]}</span>
                          {!on ? (
                            <span className={styles.muted}>{cat === "post" ? "Rest day" : "Fasting - skipped"}</span>
                          ) : (
                            <select value={chosen ? chosen.id : ""} onChange={(e) => choose(d.id, cat, e.target.value || null)}>
                              <option value="">Not chosen</option>
                              <MealOptions cat={cat} />
                            </select>
                          )}
                        </label>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </section>

          <section className={`${styles.card} ${styles.listCard}`}>
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>Shopping list</h2>
              {itemCount > 0 && (
                <button type="button" className={styles.primary} onClick={() => void copy()}>
                  {copied ? "Copied" : "Copy list"}
                </button>
              )}
            </div>
            {itemCount === 0 ? (
              <p className={styles.muted}>Pick the week's meals and the list builds itself here.</p>
            ) : (
              <>
                <p className={styles.muted}>
                  {itemCount} items · {ticked} in the trolley. Weights are as the plan gives them - raw or cooked, as marked. Skipped meals (rest and fasting days) aren't included.
                </p>
                {[...list.entries()].map(([section, ls]) => (
                  <div key={section} className={styles.section}>
                    <h3 className={styles.sectionTitle}>{section}</h3>
                    <ul className={styles.items}>
                      {ls.map((l) => {
                        const done = week.checked.includes(l.item);
                        return (
                          <li key={l.item}>
                            <label className={`${styles.item} ${done ? styles.done : ""}`}>
                              <input type="checkbox" checked={done} onChange={() => tick(l.item)} />
                              <span className={styles.itemName}>
                                {l.item}
                                {l.as.size === 1 && <small> · {[...l.as][0]}</small>}
                              </span>
                              <span className={styles.qty}>
                                {l.g ? amount(l.g) : [...l.amounts].join(" / ") || "to taste"}
                                <small>
                                  {" "}
                                  · {l.servings} {l.servings === 1 ? "meal" : "meals"}
                                </small>
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </>
            )}
          </section>

          <section className={`${styles.card} ${styles.planCard}`}>
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>All the meals</h2>
              <select value={viewPerson} onChange={(e) => setViewPerson(e.target.value as Person)} aria-label="Portions for">
                {PEOPLE.map((p) => (
                  <option key={p.id} value={p.id}>
                    Portions for {p.name}
                  </option>
                ))}
              </select>
            </div>
            <p className={styles.muted}>
              {viewPerson === "malcolm" ? `${weekPlan(week).name}` : "Lizette's plan · 1500 kcal"} · every meal portioned for{" "}
              {viewPerson === "malcolm" ? "Malcolm" : "Lizette"}, whichever plan it's from.
            </p>
            {CATEGORIES.map((cat) => {
              const target = targetFor(viewPerson, weekPlan(week).id, cat);
              return (
                <div key={cat} className={styles.section}>
                  <h3 className={styles.sectionTitle}>
                    {CATEGORY_NAMES[cat]} <span className={styles.muted}>· {target} kcal{cat === "post" ? " · training days only" : ""}</span>
                  </h3>
                  {LIBRARY[cat].map((base) => {
                    const m = portion(base, target);
                    const key = `${viewPerson}-${m.id}`;
                    return (
                      <div key={m.id} className={styles.meal}>
                        <button type="button" className={styles.mealHead} onClick={() => setOpen(open === key ? null : key)} aria-expanded={open === key}>
                          <b>{m.name}</b>
                          <span className={styles.muted}>
                            {base.source} · P {m.protein} g · C {m.carbs} g · F {m.fat} g
                          </span>
                        </button>
                        {open === key && (
                          <div className={styles.mealBody}>
                            <ul className={styles.ingredients}>
                              {m.ingredients.map((i) => (
                                <li key={i.item}>
                                  <b>{i.g ? `${i.g} g` : i.amount}</b> {i.item}
                                  {i.as ? `, ${i.as}` : ""}
                                </li>
                              ))}
                            </ul>
                            {m.method && (
                              <ol className={styles.method}>
                                {m.method.map((step) => (
                                  <li key={step}>{step}</li>
                                ))}
                              </ol>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </section>
        </div>
      )}
    </div>
  );
}
