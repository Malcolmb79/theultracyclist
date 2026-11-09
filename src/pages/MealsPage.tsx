import { useEffect, useMemo, useRef, useState } from "react";
import { useAuthSession } from "../utils/useAuthSession";
import { useDashboardTheme } from "../utils/useDashboardTheme";
import SignInGate from "../components/shared/SignInGate";
import TabNav from "../components/shared/TabNav";
import PageHeader from "../components/shared/PageHeader";
import ProfileMenu from "../components/shared/ProfileMenu";
import { PLANS, REST_DAYS, SECTIONS, type CategoryId, type Meal, type Plan, type Section } from "../data/mealPlan";
import styles from "./MealsPage.module.css";

// The meal plan as a week: for each day, the plan it follows, whether it's a
// training day (the post-workout snack) and whether it's a fasting day (no
// breakfast), and a meal from each category that's on. The shopping list
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
};

const planById = new Map(PLANS.map((p) => [p.id, p]));
const mealById = new Map<string, Meal>(PLANS.flatMap((p) => p.categories.flatMap((c) => c.meals.map((m) => [m.id, m] as [string, Meal]))));

const weekPlan = (w: Week): Plan => planById.get(w.plan ?? "") ?? PLANS[0];
const dayPlanOf = (w: Week, day: string): Plan => planById.get(w.dayPlan?.[day] ?? "") ?? weekPlan(w);
/** A training day - from the exercise plan (rest on Thursday and Sunday) unless switched. */
const isTraining = (w: Week, day: string) => w.training?.[day] ?? !REST_DAYS.has(day);
const isFasting = (w: Week, day: string) => !!w.fast?.[day];
/** Whether a category is on for a day: no post-workout snack on a rest day, no breakfast on a fasting day. */
const isOn = (w: Week, day: string, cat: CategoryId) => (cat === "post" ? isTraining(w, day) : cat === "breakfast" ? !isFasting(w, day) : true);

/** The day's meals that count: in its plan, for categories that are on. */
function dayMeals(w: Week, day: string): Meal[] {
  const plan = dayPlanOf(w, day);
  const out: Meal[] = [];
  for (const c of plan.categories) {
    if (!isOn(w, day, c.id)) continue;
    const id = w.days[day]?.[c.id];
    const m = id ? mealById.get(id) : undefined;
    if (m && c.meals.some((x) => x.id === m.id)) out.push(m);
  }
  return out;
}

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
    for (const meal of dayMeals(week, d.id)) {
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

/** The day's totals, and its target: the plan's, less the categories that are off. */
function dayTotals(w: Week, day: string) {
  const plan = dayPlanOf(w, day);
  const meals = dayMeals(w, day);
  const sum = (k: "kcal" | "protein" | "carbs" | "fat") => meals.reduce((a, m) => a + (m[k] ?? 0), 0);
  const off = plan.categories.filter((c) => !isOn(w, day, c.id)).reduce((a, c) => a + c.kcal, 0);
  return { kcal: sum("kcal"), protein: sum("protein"), target: plan.daily.kcal - off, unknown: meals.some((m) => m.kcal == null) };
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
  const [viewPlan, setViewPlan] = useState<string | null>(null);

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
  /** Every day following the week's plan gets this meal (where the category is on). */
  const everyDay = (cat: CategoryId, id: string | null) =>
    week &&
    update(
      started({
        ...week,
        days: Object.fromEntries(
          DAYS.map((d) => [d.id, dayPlanOf(week, d.id).id === weekPlan(week).id ? { ...week.days[d.id], [cat]: id } : (week.days[d.id] ?? {})]),
        ),
      }),
    );
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
  const shownPlan = planById.get(viewPlan ?? "") ?? (week ? weekPlan(week) : PLANS[0]);

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
        subtitle="Tristan's meal plan as a week: one meal from each category a day, the post-workout snack only on training days, and breakfast off on fasting days. The shopping list adds it all up."
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
            <div className={styles.everyDay}>
              <label className={styles.everyDayItem}>
                <b>Plan</b>
                <select value={weekPlan(week).id} onChange={(e) => setWeekPlan(e.target.value)} aria-label="The week's plan">
                  {PLANS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <span className={styles.muted}>Same every day:</span>
              {weekPlan(week)
                .categories.filter((c) => c.meals.length)
                .map((c) => (
                  <label key={c.id} className={styles.everyDayItem}>
                    <span>{c.name}</span>
                    <select value="" onChange={(e) => everyDay(c.id, e.target.value === "none" ? null : e.target.value)} aria-label={`${c.name} every day`}>
                      <option value="">Choose…</option>
                      {c.meals.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
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
                      <span className={styles.muted} title={`Protein ${t.protein} g`}>
                        {t.kcal}
                        {t.unknown ? "+" : ""} / {t.target} kcal
                      </span>
                    </div>
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
                    {plan.categories.map((c) => {
                      const on = isOn(week, d.id, c.id);
                      return (
                        <label key={c.id} className={`${styles.slot} ${on ? "" : styles.off}`}>
                          <span className={styles.slotName}>{c.name}</span>
                          {!on ? (
                            <span className={styles.muted}>{c.id === "post" ? "Rest day" : "Fasting - skipped"}</span>
                          ) : (
                            <select
                              value={c.meals.some((m) => m.id === week.days[d.id]?.[c.id]) ? (week.days[d.id]?.[c.id] ?? "") : ""}
                              onChange={(e) => choose(d.id, c.id, e.target.value || null)}
                            >
                              <option value="">Not chosen</option>
                              {c.meals.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name}
                                </option>
                              ))}
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
              <h2 className={styles.cardTitle}>The plan</h2>
              <select value={shownPlan.id} onChange={(e) => setViewPlan(e.target.value)} aria-label="Plan to show">
                {PLANS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <p className={styles.muted}>
              {shownPlan.daily.kcal} kcal a day · protein {shownPlan.daily.protein} g · carbs {shownPlan.daily.carbs} g · fat {shownPlan.daily.fat} g
            </p>
            {shownPlan.categories.map((c) => (
              <div key={c.id} className={styles.section}>
                <h3 className={styles.sectionTitle}>
                  {c.name} <span className={styles.muted}>· about {c.kcal} kcal{c.trainingOnly ? " · training days only" : ""}</span>
                </h3>
                {c.meals.map((m) => (
                  <div key={m.id} className={styles.meal}>
                    <button type="button" className={styles.mealHead} onClick={() => setOpen(open === m.id ? null : m.id)} aria-expanded={open === m.id}>
                      <b>{m.name}</b>
                      <span className={styles.muted}>
                        {m.kcal != null ? `${m.kcal} kcal · P ${m.protein} g · C ${m.carbs} g · F ${m.fat} g` : "kcal to be added"}
                      </span>
                    </button>
                    {open === m.id && (
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
                ))}
              </div>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}
