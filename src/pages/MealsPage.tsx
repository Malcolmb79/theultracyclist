import { useEffect, useMemo, useRef, useState } from "react";
import { useAuthSession } from "../utils/useAuthSession";
import { useDashboardTheme } from "../utils/useDashboardTheme";
import SignInGate from "../components/shared/SignInGate";
import TabNav from "../components/shared/TabNav";
import PageHeader from "../components/shared/PageHeader";
import ProfileMenu from "../components/shared/ProfileMenu";
import { DAILY, MEAL_PLAN, SECTIONS, type CategoryId, type Meal, type Section } from "../data/mealPlan";
import styles from "./MealsPage.module.css";

// The meal plan as a week: pick a meal from each category for each day, and
// the shopping list adds up every ingredient across the week, grouped by
// where it is in the shop, to tick off as it goes in the trolley. The week
// and the ticks are kept on the site (api/_routes/meal-plan.ts), so they're
// the same on the phone in the shop as on the computer that planned them.

const DAYS = [
  { id: "mon", name: "Monday" },
  { id: "tue", name: "Tuesday" },
  { id: "wed", name: "Wednesday" },
  { id: "thu", name: "Thursday" },
  { id: "fri", name: "Friday" },
  { id: "sat", name: "Saturday" },
  { id: "sun", name: "Sunday" },
] as const;

type Week = { days: Record<string, Partial<Record<CategoryId, string | null>>>; checked: string[]; startedOn?: string };

const mealById = new Map<string, Meal>(MEAL_PLAN.flatMap((c) => c.meals.map((m) => [m.id, m] as [string, Meal])));

function amount(g: number): string {
  return g >= 1000 ? `${(g / 1000).toFixed(g >= 10_000 ? 1 : 2).replace(/\.?0+$/, "")} kg` : `${Math.round(g)} g`;
}

interface Line {
  item: string;
  section: Section;
  g: number;
  servings: number;
  /** How it's weighed, where the plan says ("cooked weight", "uncooked"). */
  as: Set<string>;
  /** Amounts in words, for "to taste" items. */
  amounts: Set<string>;
}

/** Everything the week's meals need, added up by shopping item. */
function shoppingList(week: Week): Map<Section, Line[]> {
  const lines = new Map<string, Line>();
  for (const d of DAYS) {
    for (const id of Object.values(week.days[d.id] ?? {})) {
      const meal = id ? mealById.get(id) : undefined;
      if (!meal) continue;
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

function dayTotals(day: Week["days"][string] | undefined) {
  let kcal = 0;
  let protein = 0;
  let carbs = 0;
  let fat = 0;
  let unknown = false;
  for (const id of Object.values(day ?? {})) {
    const m = id ? mealById.get(id) : undefined;
    if (!m) continue;
    if (m.kcal == null) unknown = true;
    kcal += m.kcal ?? 0;
    protein += m.protein ?? 0;
    carbs += m.carbs ?? 0;
    fat += m.fat ?? 0;
  }
  return { kcal, protein, carbs, fat, unknown };
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

  useEffect(() => {
    if (auth.status !== "signed-in") return;
    fetch("/api/meal-plan")
      .then((r) => (r.ok ? (r.json() as Promise<{ week: Week }>) : Promise.reject(new Error(`Couldn't load (${r.status})`))))
      .then((a) => setWeek({ days: a.week.days ?? {}, checked: a.week.checked ?? [], startedOn: a.week.startedOn }))
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

  const choose = (day: string, cat: CategoryId, id: string | null) =>
    week && update({ ...week, days: { ...week.days, [day]: { ...week.days[day], [cat]: id } }, startedOn: week.startedOn ?? today() });
  const everyDay = (cat: CategoryId, id: string | null) =>
    week &&
    update({
      ...week,
      days: Object.fromEntries(DAYS.map((d) => [d.id, { ...week.days[d.id], [cat]: id }])),
      startedOn: week.startedOn ?? today(),
    });
  const tick = (item: string) =>
    week && update({ ...week, checked: week.checked.includes(item) ? week.checked.filter((x) => x !== item) : [...week.checked, item] });
  const newWeek = () => {
    if (week && window.confirm("Start a new week? This clears the week's meals and the ticks on the shopping list.")) update({ days: {}, checked: [], startedOn: today() });
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
        subtitle={`Your meal plan from Tristan: ${DAILY.kcal} kcal a day - protein ${DAILY.protein} g, carbs ${DAILY.carbs} g, fat ${DAILY.fat} g. Pick one meal from each category for each day; the post-workout snack only on training days. The shopping list adds it all up.`}
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
              <span className={styles.muted}>Same every day:</span>
              {MEAL_PLAN.filter((c) => c.meals.length).map((c) => (
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
                const t = dayTotals(week.days[d.id]);
                return (
                  <div key={d.id} className={styles.day}>
                    <div className={styles.dayHead}>
                      <b>{d.name}</b>
                      {t.kcal > 0 && (
                        <span className={styles.muted} title={`Protein ${t.protein} g · carbs ${t.carbs} g · fat ${t.fat} g`}>
                          {t.kcal}
                          {t.unknown ? "+" : ""} kcal · P {t.protein} g
                        </span>
                      )}
                    </div>
                    {MEAL_PLAN.map((c) => (
                      <label key={c.id} className={styles.slot}>
                        <span className={styles.slotName}>{c.name}</span>
                        {c.meals.length ? (
                          <select value={week.days[d.id]?.[c.id] ?? ""} onChange={(e) => choose(d.id, c.id, e.target.value || null)}>
                            <option value="">{c.trainingOnly ? "None (rest day)" : "Not chosen"}</option>
                            {c.meals.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className={styles.muted}>To be added</span>
                        )}
                      </label>
                    ))}
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
                  {itemCount} items · {ticked} in the trolley. Weights are as the plan gives them - raw or cooked, as marked.
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
            <h2 className={styles.cardTitle}>The plan</h2>
            {MEAL_PLAN.map((c) => (
              <div key={c.id} className={styles.section}>
                <h3 className={styles.sectionTitle}>
                  {c.name} <span className={styles.muted}>· about {c.kcal} kcal{c.trainingOnly ? " · training days only" : ""}</span>
                </h3>
                {c.meals.length === 0 && <p className={styles.muted}>These pages weren't in the screenshots yet - to be added.</p>}
                {c.meals.map((m) => (
                  <div key={m.id} className={styles.meal}>
                    <button type="button" className={styles.mealHead} onClick={() => setOpen(open === m.id ? null : m.id)} aria-expanded={open === m.id}>
                      <b>{m.name}</b>
                      <span className={styles.muted}>
                        {m.kcal != null ? `${m.kcal} kcal · P ${m.protein} g · C ${m.carbs} g · F ${m.fat} g` : "kcal to be added"}
                        {m.incomplete ? " · list may be incomplete" : ""}
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
