import { useCallback, useEffect, useRef, useState } from "react";
import DataCatalog from "../components/dashboard/DataCatalog";
import DashboardWidget from "../components/dashboard/DashboardWidget";
import { useDashboardData } from "../components/dashboard/useDashboardData";
import { useRawSources } from "../utils/useRawSources";
import { usePullToRefresh } from "../utils/usePullToRefresh";
import type { PageDateRanges } from "../utils/dateRange";
import PullToRefreshIndicator from "../components/shared/PullToRefreshIndicator";
import {
  WHOOP_STRAIN_RECOVERY_COMBO_ID,
  WHOOP_RINGS_COMBO_ID,
  HEALTH_CALENDAR_ID,
  CALORIES_BALANCE_ID,
  ALL_ACTIVITY_ID,
  DEFAULT_WIDGET_WIDTH,
  DEFAULT_WIDGET_HEIGHT,
  type Widget,
} from "../components/dashboard/types";
import type { MetricDef } from "../components/dashboard/useDashboardData";
import { useAuthSession } from "../utils/useAuthSession";
import SignInGate from "../components/shared/SignInGate";
import TabNav from "../components/shared/TabNav";
import PageHeader from "../components/shared/PageHeader";
import ProfileMenu from "../components/shared/ProfileMenu";
import { computeCanvasHeight, rescueOffCanvasX, usableCanvasWidth } from "../utils/useCanvasItem";
import { useDeviceCategory } from "../utils/useDeviceCategory";
import { useDashboardTheme } from "../utils/useDashboardTheme";
import styles from "./DashboardPage.module.css";

function nextId(): string {
  return `w_${Date.now()}_${Math.round(Math.random() * 1e6)}`;
}

function defaultViewType(metric: MetricDef): Widget["viewType"] {
  if (metric.id === WHOOP_STRAIN_RECOVERY_COMBO_ID) return "combo";
  if (metric.id === WHOOP_RINGS_COMBO_ID) return "rings";
  if (metric.id === HEALTH_CALENDAR_ID) return "healthCalendar";
  if (metric.id === CALORIES_BALANCE_ID) return "caloriesBalance";
  if (metric.id === ALL_ACTIVITY_ID) return "allActivity";
  return metric.statOnly ? "stat" : "chart";
}

// New widgets cascade below whatever's already on the canvas rather than
// stacking at (0,0) on top of each other - left-aligned, just under the
// lowest existing widget's bottom edge.
function nextWidgetPosition(existing: Widget[]): { x: number; y: number } {
  const bottom = existing.reduce((max, w) => Math.max(max, (w.y ?? 0) + (w.height ?? DEFAULT_WIDGET_HEIGHT)), 0);
  return { x: 0, y: bottom > 0 ? bottom + 20 : 0 };
}

export default function DashboardPage() {
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
    return <SignInGate title="Dashboard" />;
  }

  return <DashboardEditor />;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

function DashboardEditor() {
  const device = useDeviceCategory();
  const raw = useRawSources(device);
  const data = useDashboardData(raw);
  const stacked = device === "mobile";
  // Drag-down-to-refresh (mobile) - re-fetches Whoop/Strava/Apple
  // Health/settings in the background without unmounting the widgets
  // currently on screen (see useRawSources' refetch).
  const handlePullRefresh = useCallback(async () => {
    if (raw.status === "ready") await raw.refetch();
  }, [raw]);
  const pull = usePullToRefresh(handlePullRefresh);
  const rawSettings = raw.status === "ready" ? raw.settings : {};
  const pageDateRanges = rawSettings.pageDateRanges as PageDateRanges | undefined;
  const caloriesBurnSettings = {
    wakeTime: rawSettings.caloriesBurnWakeTime as string | undefined,
    targetKcal: rawSettings.caloriesBurnTarget as number | undefined,
    targetTime: rawSettings.caloriesBurnTargetTime as string | undefined,
  };
  const [widgets, setWidgets] = useState<Widget[] | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const lastAttempt = useRef<Widget[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setWidgets(null);
    fetch(`/api/dashboard-layout?device=${device}`)
      .then((res) => res.json())
      .then((body: { widgets: Widget[] }) => {
        if (!cancelled) setWidgets(body.widgets ?? []);
      })
      .catch(() => {
        if (!cancelled) setWidgets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [device]);

  const persist = (next: Widget[]) => {
    lastAttempt.current = next;
    setSaveStatus("saving");
    fetch("/api/dashboard-layout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ widgets: next, device }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Save failed: ${res.status}`);
        setSaveStatus("saved");
      })
      .catch(() => {
        setSaveStatus("error");
      });
  };

  const saveWidgets = (next: Widget[]) => {
    setWidgets(next);
    persist(next);
  };

  const retrySave = () => {
    if (lastAttempt.current) persist(lastAttempt.current);
  };

  if (data.status === "loading" || widgets === null) {
    return (
      <div className={styles.page}>
        <p className={styles.loading}>Loading dashboard…</p>
      </div>
    );
  }

  const metricById = new Map(data.metrics.map((m) => [m.id, m]));

  const handleAdd = (metric: MetricDef) => {
    const position = nextWidgetPosition(widgets);
    const widget: Widget = {
      id: nextId(),
      source: metric.source,
      metric: metric.id,
      label: metric.label,
      viewType: defaultViewType(metric),
      x: position.x,
      y: position.y,
      width: DEFAULT_WIDGET_WIDTH,
      height: DEFAULT_WIDGET_HEIGHT,
    };
    saveWidgets([...widgets, widget]);
    setCatalogOpen(false);
  };

  const handleRemove = (id: string) => saveWidgets(widgets.filter((w) => w.id !== id));

  const handleViewTypeChange = (id: string, viewType: Widget["viewType"]) =>
    saveWidgets(widgets.map((w) => (w.id === id ? { ...w, viewType } : w)));

  const handleColorChange = (id: string, color: string) =>
    saveWidgets(widgets.map((w) => (w.id === id ? { ...w, color } : w)));

  const handleLabelChange = (id: string, label: string) =>
    saveWidgets(widgets.map((w) => (w.id === id ? { ...w, label } : w)));

  const handleMove = (id: string, x: number, y: number) =>
    saveWidgets(widgets.map((w) => (w.id === id ? { ...w, x, y } : w)));

  const handleResize = (id: string, width: number, height: number) =>
    saveWidgets(widgets.map((w) => (w.id === id ? { ...w, width, height } : w)));

  const handleDateRangeChange = (id: string, dateRange: Widget["dateRange"]) =>
    saveWidgets(widgets.map((w) => (w.id === id ? { ...w, dateRange } : w)));

  // Phone-only: reordering by swapping array position rather than dragging,
  // since the stacked layout has no x/y to drag - see the `stacked` render
  // branch below.
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
      <PullToRefreshIndicator pullDistance={pull.pullDistance} refreshing={pull.refreshing} triggerDistance={pull.triggerDistance} />
      <div className={styles.topBar}>
        <TabNav
          items={[
            { label: "Dashboard", href: "/dashboard", active: true },
            { label: "Trends", href: "/dashboard/trends" },
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

      <PageHeader title="Dashboard" subtitle="Drag, resize, and add widgets from your connected data sources." />

      {catalogOpen && <div className={styles.catalogBackdrop} onClick={() => setCatalogOpen(false)} />}

      <aside className={`${styles.catalogDrawer} ${catalogOpen ? styles.catalogDrawerOpen : ""}`}>
        <DataCatalog metrics={data.metrics} onAdd={handleAdd} />
      </aside>

      <main className={styles.canvas}>
        {widgets.length === 0 ? (
          <p className={styles.emptyCanvas}>Open the menu to add data and build your dashboard.</p>
        ) : stacked ? (
          <div className={styles.stackList}>
            {widgets.map((widget, index) => (
              <DashboardWidget
                key={widget.id}
                widget={widget}
                metricById={metricById}
                whoopHistory={data.whoopHistory}
                performanceSeries={data.performanceSeries}
                caloriesBurnSettings={caloriesBurnSettings}
                goals={data.goals}
                stacked
                canMoveUp={index > 0}
                canMoveDown={index < widgets.length - 1}
                onReorder={(direction) => handleReorder(widget.id, direction)}
                onViewTypeChange={(viewType) => handleViewTypeChange(widget.id, viewType)}
                onColorChange={(color) => handleColorChange(widget.id, color)}
                onLabelChange={(label) => handleLabelChange(widget.id, label)}
                onMove={(x, y) => handleMove(widget.id, x, y)}
                onResize={(width, height) => handleResize(widget.id, width, height)}
                onResizingChange={setIsResizing}
                onRemove={() => handleRemove(widget.id)}
                onDateRangeChange={(range) => handleDateRangeChange(widget.id, range)}
                page="dashboard"
                pageDateRanges={pageDateRanges}
              />
            ))}
          </div>
        ) : (
          <div
            className={`${styles.widgetGrid} ${isResizing ? styles.widgetGridSnap : ""}`}
            style={{ height: canvasHeight }}
          >
            {widgets.map((widget) => (
              <DashboardWidget
                key={widget.id}
                // A saved x beyond the canvas leaves a widget unreachable -
                // see rescueOffCanvasX. Only applied on this absolutely
                // positioned canvas; the stacked branch above lays out in
                // flow and ignores x entirely.
                widget={{
                  ...widget,
                  x: rescueOffCanvasX(widget.x ?? 0, widget.width ?? DEFAULT_WIDGET_WIDTH, usableCanvasWidth()),
                }}
                metricById={metricById}
                whoopHistory={data.whoopHistory}
                performanceSeries={data.performanceSeries}
                caloriesBurnSettings={caloriesBurnSettings}
                goals={data.goals}
                onViewTypeChange={(viewType) => handleViewTypeChange(widget.id, viewType)}
                onColorChange={(color) => handleColorChange(widget.id, color)}
                onLabelChange={(label) => handleLabelChange(widget.id, label)}
                onMove={(x, y) => handleMove(widget.id, x, y)}
                onResize={(width, height) => handleResize(widget.id, width, height)}
                onResizingChange={setIsResizing}
                onRemove={() => handleRemove(widget.id)}
                onDateRangeChange={(range) => handleDateRangeChange(widget.id, range)}
                page="dashboard"
                pageDateRanges={pageDateRanges}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
