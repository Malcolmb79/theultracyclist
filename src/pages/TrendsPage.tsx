import { useEffect, useRef, useState } from "react";
import TrendsCatalog from "../components/trends/TrendsCatalog";
import TrendsWidget from "../components/trends/TrendsWidget";
import { useTrendsData, type TrendMetricDef } from "../components/trends/useTrendsData";
import { GOAL_METRIC_IDS, PROGRESS_PHOTOS_ID, type TrendsWidgetConfig, type TrendsViewType } from "../components/trends/types";
import { CALORIES_BALANCE_ID, HEALTH_CALENDAR_ID, MACRO_SPLIT_ID, PERFORMANCE_CHART_ID } from "../components/dashboard/types";
import type { MacroGrams } from "../utils/macros";
import { isEnergyMetricId, type EnergyKind } from "../utils/energy";
import { useAuthSession } from "../utils/useAuthSession";
import SignInGate from "../components/shared/SignInGate";
import TabNav from "../components/shared/TabNav";
import PageHeader from "../components/shared/PageHeader";
import ProfileMenu from "../components/shared/ProfileMenu";
import { computeCanvasHeight, rescueOffCanvasX, usableCanvasWidth } from "../utils/useCanvasItem";
import { DEFAULT_WIDGET_HEIGHT, DEFAULT_WIDGET_WIDTH as DEFAULT_TRENDS_WIDGET_WIDTH } from "../components/trends/types";
import { useDeviceCategory } from "../utils/useDeviceCategory";
import { useDashboardTheme } from "../utils/useDashboardTheme";
import styles from "./TrendsPage.module.css";

function nextId(): string {
  return `t_${Date.now()}_${Math.round(Math.random() * 1e6)}`;
}

// New widgets cascade below whatever's already on the canvas rather than
// stacking at (0,0) on top of each other.
function nextWidgetPosition(existing: TrendsWidgetConfig[]): { x: number; y: number } {
  const bottom = existing.reduce((max, w) => Math.max(max, (w.y ?? 0) + (w.height ?? DEFAULT_WIDGET_HEIGHT)), 0);
  return { x: 0, y: bottom > 0 ? bottom + 20 : 0 };
}

export default function TrendsPage() {
  useDashboardTheme();
  const auth = useAuthSession();

  if (auth.status === "loading") {
    return (
      <div className={styles.page}>
        <p className={styles.loading}>Loading…</p>
      </div>
    );
  }

  if (auth.status === "signed-out") {
    return <SignInGate title="Trends" />;
  }

  return <TrendsEditor />;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

function TrendsEditor() {
  const data = useTrendsData();
  const pageDateRanges = data.status === "ready" ? data.pageDateRanges : undefined;
  const device = useDeviceCategory();
  const stacked = device === "mobile";
  const [widgets, setWidgets] = useState<TrendsWidgetConfig[] | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const lastAttempt = useRef<TrendsWidgetConfig[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setWidgets(null);
    fetch(`/api/trends-layout?device=${device}`)
      .then((res) => res.json())
      .then((body: { widgets: TrendsWidgetConfig[] }) => {
        if (!cancelled) setWidgets(body.widgets ?? []);
      })
      .catch(() => {
        if (!cancelled) setWidgets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [device]);

  const persist = (next: TrendsWidgetConfig[]) => {
    lastAttempt.current = next;
    setSaveStatus("saving");
    fetch("/api/trends-layout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ widgets: next, device }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Save failed: ${res.status}`);
        setSaveStatus("saved");
      })
      .catch(() => setSaveStatus("error"));
  };

  const saveWidgets = (next: TrendsWidgetConfig[]) => {
    setWidgets(next);
    persist(next);
  };

  const retrySave = () => {
    if (lastAttempt.current) persist(lastAttempt.current);
  };

  if (data.status === "loading" || widgets === null) {
    return (
      <div className={styles.page}>
        <p className={styles.loading}>Loading trends…</p>
      </div>
    );
  }

  const metricById = new Map(data.metrics.map((m) => [m.id, m]));

  // A goal-progress widget is identified by its metric id, so which of the
  // three dated goals it shows is decided in one place rather than at every
  // render site.
  const datedGoalFor = (metricId: string) => {
    if (metricId === GOAL_METRIC_IDS.weight) return data.datedGoals.weight;
    if (metricId === GOAL_METRIC_IDS.ftp) return data.datedGoals.ftp;
    if (metricId === GOAL_METRIC_IDS.sleepWeekly) return data.datedGoals.sleepWeekly;
    return undefined;
  };

  // The Macro Split card wants all three macros for one date, which the
  // per-macro goal metrics already know how to read - no second lookup path
  // into the Apple Health catalog.
  const macroGramsFor = (date: string): MacroGrams => {
    const valueOf = (id: string) => data.metrics.find((m) => m.id === id)?.getValue(date) ?? null;
    return {
      carbs: valueOf(GOAL_METRIC_IDS.carbs),
      fat: valueOf(GOAL_METRIC_IDS.fat),
      protein: valueOf(GOAL_METRIC_IDS.protein),
    };
  };

  // Consumed/burned come from the plain Apple Health metrics the catalog
  // already exposes, matched by pattern rather than by exact field name -
  // see energy.ts.
  const energyFor = (date: string, kind: EnergyKind): number | null =>
    data.metrics.find((m) => m.source === "health" && isEnergyMetricId(m.id, kind))?.getValue(date) ?? null;

  const handleAdd = (metric: TrendMetricDef) => {
    const position = nextWidgetPosition(widgets);
    const widget: TrendsWidgetConfig = {
      id: nextId(),
      metric: metric.id,
      label: metric.label,
      viewType:
        metric.id === PROGRESS_PHOTOS_ID
          ? "progressPhotos"
          : metric.id === MACRO_SPLIT_ID
            ? "macroSplit"
          : metric.id === CALORIES_BALANCE_ID
            ? "day"
          : metric.id === HEALTH_CALENDAR_ID
            ? "healthCalendar"
          : metric.id === PERFORMANCE_CHART_ID
            ? "performanceChart"
            : // Opens on the question the goal was set to answer; the daily
              // and weekly views are still a pill away.
              datedGoalFor(metric.id)
              ? "goalProgress"
              : "day",
      x: position.x,
      y: position.y,
    };
    saveWidgets([...widgets, widget]);
    setCatalogOpen(false);
  };

  const handleRemove = (id: string) => saveWidgets(widgets.filter((w) => w.id !== id));

  const handleViewTypeChange = (id: string, viewType: TrendsViewType) =>
    saveWidgets(widgets.map((w) => (w.id === id ? { ...w, viewType } : w)));

  const handleColorChange = (id: string, color: string) =>
    saveWidgets(widgets.map((w) => (w.id === id ? { ...w, color } : w)));

  const handleMove = (id: string, x: number, y: number) =>
    saveWidgets(widgets.map((w) => (w.id === id ? { ...w, x, y } : w)));

  const handleDateRangeChange = (id: string, dateRange: TrendsWidgetConfig["dateRange"]) =>
    saveWidgets(widgets.map((w) => (w.id === id ? { ...w, dateRange } : w)));

  const handleResize = (id: string, width: number, height: number) =>
    saveWidgets(widgets.map((w) => (w.id === id ? { ...w, width, height } : w)));

  const handleReorder = (id: string, direction: "up" | "down") => {
    const index = widgets.findIndex((w) => w.id === id);
    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (index === -1 || swapWith < 0 || swapWith >= widgets.length) return;
    const next = widgets.slice();
    [next[index], next[swapWith]] = [next[swapWith], next[index]];
    saveWidgets(next);
  };

  const canvasHeight = computeCanvasHeight(
    widgets.map((w) => ({ y: w.y ?? 0, height: w.height ?? DEFAULT_WIDGET_HEIGHT })),
  );

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <TabNav
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Trends", href: "/dashboard/trends", active: true },
            { label: "Coaching", href: "/dashboard/coaching" },
          ]}
          trailing={
            <>
              <button
                type="button"
                className={styles.catalogToggle}
                onClick={() => setCatalogOpen((open) => !open)}
                aria-label={catalogOpen ? "Close data menu" : "Open data menu"}
                aria-expanded={catalogOpen}
              >
                {catalogOpen ? "×" : "☰"}
              </button>
              {saveStatus === "error" ? (
                <button type="button" className={`${styles.saveStatus} ${styles.saveStatusError}`} onClick={retrySave}>
                  Save failed — tap to retry
                </button>
              ) : (
                saveStatus !== "idle" && (
                  <span className={`${styles.saveStatus} ${saveStatus === "saved" ? styles.saveStatusSaved : ""}`}>
                    {saveStatus === "saving" ? "Saving…" : "Saved"}
                  </span>
                )
              )}
              <ProfileMenu />
            </>
          }
        />
      </div>

      <PageHeader title="Trends" subtitle="Daily, weekly, and monthly views of your training and recovery data." />

      {catalogOpen && <div className={styles.catalogBackdrop} onClick={() => setCatalogOpen(false)} />}

      <aside className={`${styles.catalogDrawer} ${catalogOpen ? styles.catalogDrawerOpen : ""}`}>
        <TrendsCatalog metrics={data.metrics} goals={data.goals}
                onSaveGoals={data.saveGoals} onAdd={handleAdd} />
      </aside>

      <main className={styles.canvas}>
        {widgets.length === 0 ? (
          <p className={styles.emptyCanvas}>Open the menu to add data and build your trends dashboard.</p>
        ) : stacked ? (
          <div className={styles.stackList}>
            {widgets.map((widget, index) => (
              <TrendsWidget
                key={widget.id}
                widget={widget}
                metric={metricById.get(widget.metric)}
                days={data.days}
                whoopHistory={data.whoopHistory}
                weightByDate={data.weightByDate}
                weightSeries={data.weightSeries}
                weightUnit={data.weightUnit}
                bmiByDate={data.bmiByDate}
                performanceSeries={data.performanceSeries}
                datedGoal={datedGoalFor(widget.metric)}
                macroGramsFor={macroGramsFor}
                goals={data.goals}
                energyFor={energyFor}
                stacked
                canMoveUp={index > 0}
                canMoveDown={index < widgets.length - 1}
                onReorder={(direction) => handleReorder(widget.id, direction)}
                onViewTypeChange={(viewType) => handleViewTypeChange(widget.id, viewType)}
                onColorChange={(color) => handleColorChange(widget.id, color)}
                onMove={(x, y) => handleMove(widget.id, x, y)}
                onResize={(width, height) => handleResize(widget.id, width, height)}
                onDateRangeChange={(range) => handleDateRangeChange(widget.id, range)}
                pageDateRanges={pageDateRanges}
                onResizingChange={setIsResizing}
                onRemove={() => handleRemove(widget.id)}
              />
            ))}
          </div>
        ) : (
          <div
            className={`${styles.widgetGrid} ${isResizing ? styles.widgetGridSnap : ""}`}
            style={{ height: canvasHeight }}
          >
            {widgets.map((widget) => (
              <TrendsWidget
                key={widget.id}
                // A saved x beyond the canvas leaves a widget unreachable -
                // see rescueOffCanvasX. Only applied on this absolutely
                // positioned canvas; the stacked branch above lays out in
                // flow and ignores x entirely.
                widget={{
                  ...widget,
                  x: rescueOffCanvasX(widget.x ?? 0, widget.width ?? DEFAULT_TRENDS_WIDGET_WIDTH, usableCanvasWidth()),
                }}
                metric={metricById.get(widget.metric)}
                days={data.days}
                whoopHistory={data.whoopHistory}
                weightByDate={data.weightByDate}
                weightSeries={data.weightSeries}
                weightUnit={data.weightUnit}
                bmiByDate={data.bmiByDate}
                performanceSeries={data.performanceSeries}
                datedGoal={datedGoalFor(widget.metric)}
                macroGramsFor={macroGramsFor}
                goals={data.goals}
                energyFor={energyFor}
                onViewTypeChange={(viewType) => handleViewTypeChange(widget.id, viewType)}
                onColorChange={(color) => handleColorChange(widget.id, color)}
                onMove={(x, y) => handleMove(widget.id, x, y)}
                onResize={(width, height) => handleResize(widget.id, width, height)}
                onDateRangeChange={(range) => handleDateRangeChange(widget.id, range)}
                pageDateRanges={pageDateRanges}
                onResizingChange={setIsResizing}
                onRemove={() => handleRemove(widget.id)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
