import { useCallback, useRef, useState } from "react";
import ReadinessCard from "../components/coaching/ReadinessCard";
import PowerZonesCard from "../components/coaching/PowerZonesCard";
import TrainingPlanCard from "../components/coaching/TrainingPlanCard";
import CoachChatCard from "../components/coaching/CoachChatCard";
import TrainingCalendarCard from "../components/coaching/TrainingCalendarCard";
import CoachingWidget, { COACHING_WIDGET_GRID_SIZE } from "../components/coaching/CoachingWidget";
import { useCoachingData } from "../components/coaching/useCoachingData";
import { FIXED_CARD_LABELS, type CoachingWidgetEntry, type FixedCardKind, type NarrativeInput } from "../components/coaching/types";
import DataCatalog from "../components/dashboard/DataCatalog";
import DashboardWidget from "../components/dashboard/DashboardWidget";
import { useDashboardData } from "../components/dashboard/useDashboardData";
import {
  WHOOP_STRAIN_RECOVERY_COMBO_ID,
  WHOOP_RINGS_COMBO_ID,
  HEALTH_CALENDAR_ID,
  CALORIES_BALANCE_ID,
  DEFAULT_WIDGET_WIDTH,
  DEFAULT_WIDGET_HEIGHT,
  MIN_WIDGET_WIDTH,
  type Widget,
} from "../components/dashboard/types";
import type { MetricDef } from "../components/dashboard/useDashboardData";
import { useAuthSession } from "../utils/useAuthSession";
import { useIsMobile } from "../utils/useIsMobile";
import { useDeviceCategory } from "../utils/useDeviceCategory";
import { useDashboardTheme } from "../utils/useDashboardTheme";
import { useRawSources } from "../utils/useRawSources";
import { usePullToRefresh } from "../utils/usePullToRefresh";
import { computeCanvasHeight } from "../utils/useCanvasItem";
import { fitWidgetsToWidth } from "../utils/fitWidgetsToWidth";
import SignInGate from "../components/shared/SignInGate";
import TabNav from "../components/shared/TabNav";
import PageHeader from "../components/shared/PageHeader";
import ProfileMenu from "../components/shared/ProfileMenu";
import PullToRefreshIndicator from "../components/shared/PullToRefreshIndicator";
import styles from "./CoachingPage.module.css";

type Rect = { x: number; y: number; width: number; height: number };

const MIN_SIZE: Record<FixedCardKind, { minWidth: number; minHeight: number }> = {
  readiness: { minWidth: 260, minHeight: 180 },
  chat: { minWidth: 280, minHeight: 320 },
  trainingPlan: { minWidth: 260, minHeight: 240 },
  powerZones: { minWidth: 260, minHeight: 240 },
  trainingCalendar: { minWidth: 260, minHeight: 240 },
};

const DEFAULT_DESKTOP: Record<FixedCardKind, Rect> = {
  readiness: { x: 0, y: 0, width: 340, height: 260 },
  chat: { x: 360, y: 0, width: 380, height: 460 },
  trainingPlan: { x: 0, y: 280, width: 340, height: 380 },
  powerZones: { x: 360, y: 480, width: 380, height: 380 },
  trainingCalendar: { x: 760, y: 0, width: 340, height: 460 },
};

const DEFAULT_MOBILE: Record<FixedCardKind, Rect> = {
  readiness: { x: 0, y: 0, width: 320, height: 220 },
  chat: { x: 0, y: 240, width: 320, height: 420 },
  trainingPlan: { x: 0, y: 680, width: 320, height: 380 },
  powerZones: { x: 0, y: 1080, width: 320, height: 380 },
  trainingCalendar: { x: 0, y: 1480, width: 320, height: 380 },
};

const FIXED_CARD_ORDER: FixedCardKind[] = ["readiness", "chat", "trainingPlan", "powerZones", "trainingCalendar"];

// New widgets (fixed cards re-added after removal, or metrics from the
// catalog) cascade below whatever's already on the canvas rather than
// stacking at (0,0).
function nextWidgetPosition(existing: CoachingWidgetEntry[]): { x: number; y: number } {
  const bottom = existing.reduce((max, w) => Math.max(max, (w.y ?? 0) + (w.height ?? DEFAULT_WIDGET_HEIGHT)), 0);
  return { x: 0, y: bottom > 0 ? bottom + 20 : 0 };
}

function defaultViewType(metric: MetricDef): Widget["viewType"] {
  if (metric.id === WHOOP_STRAIN_RECOVERY_COMBO_ID) return "combo";
  if (metric.id === WHOOP_RINGS_COMBO_ID) return "rings";
  if (metric.id === HEALTH_CALENDAR_ID) return "healthCalendar";
  if (metric.id === CALORIES_BALANCE_ID) return "caloriesBalance";
  return metric.statOnly ? "stat" : "chart";
}

function nextId(): string {
  return `cw_${Date.now()}_${Math.round(Math.random() * 1e6)}`;
}

// DashboardWidget only knows about the Dashboard/Trends Widget shape - a
// "metric" kind entry carries exactly those fields, just wrapped in the
// coaching page's own flat entry shape (see types.ts) so it can share one
// array/one set of add/remove/resize/move/reorder handlers with the 4 fixed
// cards.
function toWidget(entry: CoachingWidgetEntry): Widget {
  return {
    id: entry.id,
    source: entry.source ?? "whoop",
    metric: entry.metric ?? "",
    label: entry.label,
    viewType: entry.viewType ?? "stat",
    x: entry.x,
    y: entry.y,
    width: entry.width,
    height: entry.height,
    color: entry.color,
  };
}

export default function CoachingPage() {
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
    return <SignInGate title="Coaching" />;
  }

  return <CoachingView />;
}

function CoachingView() {
  const device = useDeviceCategory();
  // Coaching's default layout hardcodes a 2-column arrangement (second
  // column starts at x=360 - see DEFAULT_DESKTOP) that's wider than a
  // tablet viewport, so unlike Dashboard/Trends (which cascade new widgets
  // into a single column by default) tablet also needs the flow layout,
  // not just phone.
  const stacked = device !== "desktop";
  const raw = useRawSources(device);
  const data = useCoachingData(raw);
  const dashboardData = useDashboardData(raw);
  const isMobile = useIsMobile();
  const [isResizing, setIsResizing] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  // Drag-down-to-refresh (mobile) - re-fetches Whoop/Strava/Apple
  // Health/settings in the background without unmounting the cards
  // currently on screen (see useRawSources' refetch).
  const handlePullRefresh = useCallback(async () => {
    if (raw.status === "ready") await raw.refetch();
  }, [raw]);
  const pull = usePullToRefresh(handlePullRefresh);
  const canvasRef = useRef<HTMLElement>(null);
  const caloriesBurnSettings = {
    wakeTime: data.status === "ready" ? data.settings.caloriesBurnWakeTime : undefined,
    targetKcal: data.status === "ready" ? data.settings.caloriesBurnTarget : undefined,
    targetTime: data.status === "ready" ? data.settings.caloriesBurnTargetTime : undefined,
  };

  // Trusts the server's list as-is (see api/coaching-settings.ts's one-time
  // migration) rather than re-seeding missing fixed cards here on every
  // render - that would make removing one impossible, since it'd get
  // silently re-added on the very next render after the save round-trips.
  const widgets: CoachingWidgetEntry[] = data.status === "ready" ? (data.settings.widgets ?? []) : [];
  const metricById = new Map((dashboardData.status === "ready" ? dashboardData.metrics : []).map((m) => [m.id, m]));
  const missingFixedCards = FIXED_CARD_ORDER.filter((kind) => !widgets.some((w) => w.kind === kind));

  const saveWidgets = (next: CoachingWidgetEntry[]) => {
    if (data.status !== "ready") return;
    data.saveSettings({ ...data.settings, widgets: next });
  };

  const handleAddFixedCard = (kind: FixedCardKind) => {
    // Unlike handleAddMetric, this restores the card to its own designed
    // column/row (DEFAULT_DESKTOP/DEFAULT_MOBILE) rather than cascading it
    // below whatever's already on the canvas - nextWidgetPosition's x: 0
    // was collapsing every re-added card into a single left-hand column
    // instead of the intended multi-column desktop layout.
    const defaults = isMobile ? DEFAULT_MOBILE[kind] : DEFAULT_DESKTOP[kind];
    const entry: CoachingWidgetEntry = {
      id: kind,
      kind,
      label: FIXED_CARD_LABELS[kind],
      x: defaults.x,
      y: defaults.y,
      width: defaults.width,
      height: defaults.height,
    };
    saveWidgets([...widgets, entry]);
    setCatalogOpen(false);
  };

  const handleAddMetric = (metric: MetricDef) => {
    const position = nextWidgetPosition(widgets);
    const entry: CoachingWidgetEntry = {
      id: nextId(),
      kind: "metric",
      source: metric.source,
      metric: metric.id,
      label: metric.label,
      viewType: defaultViewType(metric),
      x: position.x,
      y: position.y,
      width: DEFAULT_WIDGET_WIDTH,
      height: DEFAULT_WIDGET_HEIGHT,
    };
    saveWidgets([...widgets, entry]);
    setCatalogOpen(false);
  };

  const handleRemove = (id: string) => saveWidgets(widgets.filter((w) => w.id !== id));

  const handleViewTypeChange = (id: string, viewType: Widget["viewType"]) =>
    saveWidgets(widgets.map((w) => (w.id === id ? { ...w, viewType } : w)));

  const handleColorChange = (id: string, color: string) => saveWidgets(widgets.map((w) => (w.id === id ? { ...w, color } : w)));

  const handleLabelChange = (id: string, label: string) => saveWidgets(widgets.map((w) => (w.id === id ? { ...w, label } : w)));

  const handleMove = (id: string, x: number, y: number) => saveWidgets(widgets.map((w) => (w.id === id ? { ...w, x, y } : w)));

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

  // Proportionally stretches every widget's x/width to fill the canvas'
  // actual current width (see fitWidgetsToWidth.ts) - a one-click way to
  // take advantage of a widened browser window/monitor without needing to
  // drag each widget out by hand. Desktop-only: the stacked phone/tablet
  // layout has no x/y positioning for this to act on.
  const handleFitToScreen = () => {
    if (!canvasRef.current) return;
    const availableWidth = canvasRef.current.clientWidth;
    const minWidthFor = (w: CoachingWidgetEntry) => (w.kind === "metric" ? MIN_WIDGET_WIDTH : MIN_SIZE[w.kind].minWidth);
    saveWidgets(fitWidgetsToWidth(widgets, availableWidth, COACHING_WIDGET_GRID_SIZE, minWidthFor));
  };

  const canvasHeight =
    data.status === "ready"
      ? computeCanvasHeight(widgets.map((w) => ({ y: w.y ?? 0, height: w.height ?? DEFAULT_WIDGET_HEIGHT })))
      : 400;

  return (
    <div className={styles.page}>
      <PullToRefreshIndicator pullDistance={pull.pullDistance} refreshing={pull.refreshing} triggerDistance={pull.triggerDistance} />
      <div className={styles.topBar}>
        <TabNav
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Trends", href: "/dashboard/trends" },
            { label: "Coaching", href: "/dashboard/coaching", active: true },
          ]}
          trailing={
            <>
              {!stacked && (
                <button type="button" className={styles.switchLink} onClick={handleFitToScreen}>
                  Fit to screen
                </button>
              )}
              <button
                type="button"
                className={styles.catalogToggle}
                onClick={() => setCatalogOpen((open) => !open)}
                aria-label={catalogOpen ? "Close data menu" : "Open data menu"}
                aria-expanded={catalogOpen}
              >
                {catalogOpen ? "×" : "☰"}
              </button>
              <ProfileMenu />
            </>
          }
        />
      </div>

      <PageHeader title="Coaching" subtitle="Readiness, power zones, and training plan progress, built from your own data." />

      {catalogOpen && <div className={styles.catalogBackdrop} onClick={() => setCatalogOpen(false)} />}

      <aside className={`${styles.catalogDrawer} ${catalogOpen ? styles.catalogDrawerOpen : ""}`}>
        {missingFixedCards.length > 0 && (
          <div className={styles.fixedCardCatalog}>
            <h2 className={styles.fixedCardCatalogTitle}>Coaching cards</h2>
            <ul className={styles.fixedCardCatalogList}>
              {missingFixedCards.map((kind) => (
                <li key={kind} className={styles.fixedCardCatalogItem}>
                  <span>{FIXED_CARD_LABELS[kind]}</span>
                  <button type="button" className={styles.fixedCardCatalogAdd} onClick={() => handleAddFixedCard(kind)}>
                    + Add
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <DataCatalog metrics={dashboardData.status === "ready" ? dashboardData.metrics : []} onAdd={handleAddMetric} />
      </aside>

      {data.status === "loading" ? (
        <p className={styles.loading}>Loading…</p>
      ) : (
        <main
          ref={canvasRef}
          className={stacked ? styles.stackList : `${styles.canvas} ${isResizing ? styles.canvasSnap : ""}`}
          style={stacked ? undefined : { height: canvasHeight }}
        >
          {widgets.map((entry, index) => {
            const rect = { x: entry.x ?? 0, y: entry.y ?? 0, width: entry.width ?? DEFAULT_WIDGET_WIDTH, height: entry.height ?? DEFAULT_WIDGET_HEIGHT };
            const reorderProps = stacked
              ? { stacked: true as const, canMoveUp: index > 0, canMoveDown: index < widgets.length - 1, onReorder: (direction: "up" | "down") => handleReorder(entry.id, direction) }
              : {};

            if (entry.kind === "metric") {
              return (
                <DashboardWidget
                  key={entry.id}
                  widget={toWidget(entry)}
                  metricById={metricById}
                  whoopHistory={dashboardData.status === "ready" ? dashboardData.whoopHistory : []}
                  performanceSeries={dashboardData.status === "ready" ? dashboardData.performanceSeries : []}
                  caloriesBurnSettings={caloriesBurnSettings}
                  onViewTypeChange={(viewType) => handleViewTypeChange(entry.id, viewType)}
                  onColorChange={(color) => handleColorChange(entry.id, color)}
                  onLabelChange={(label) => handleLabelChange(entry.id, label)}
                  onMove={(x, y) => handleMove(entry.id, x, y)}
                  onResize={(width, height) => handleResize(entry.id, width, height)}
                  onResizingChange={setIsResizing}
                  onRemove={() => handleRemove(entry.id)}
                  {...reorderProps}
                />
              );
            }

            return (
              <CoachingWidget
                key={entry.id}
                {...rect}
                {...MIN_SIZE[entry.kind]}
                onMove={(x, y) => handleMove(entry.id, x, y)}
                onResize={(width, height) => handleResize(entry.id, width, height)}
                onResizingChange={setIsResizing}
                onRemove={() => handleRemove(entry.id)}
                {...reorderProps}
              >
                {data.status === "ready" && entry.kind === "readiness" && <ReadinessCard readiness={data.readiness} />}
                {data.status === "ready" && entry.kind === "chat" && (
                  <CoachChatCard input={narrativeInputFrom(data)} settings={data.settings} onSaveSettings={data.saveSettings} dataAvailable={data.dataAvailable} />
                )}
                {data.status === "ready" && entry.kind === "trainingPlan" && (
                  <TrainingPlanCard settings={data.settings} onSaveSettings={data.saveSettings} weeklyProgress={data.weeklyProgress} />
                )}
                {data.status === "ready" && entry.kind === "powerZones" && <PowerZonesCard settings={data.settings} recentRides={data.recentRides} />}
                {entry.kind === "trainingCalendar" && <TrainingCalendarCard />}
              </CoachingWidget>
            );
          })}
        </main>
      )}
    </div>
  );
}

function narrativeInputFrom(data: Extract<ReturnType<typeof useCoachingData>, { status: "ready" }>): NarrativeInput {
  const latest = data.recoveryHistory.at(-1);
  // Recovery/HRV/RHR/sleep are a once-daily morning reading (see
  // DATA_SEMANTICS) - when today's hasn't landed yet, `latest` is still
  // yesterday's. Passing those through anyway would have the coach cite a
  // stale number as if it were today's (the same class of bug that made it
  // fabricate a "last week" date range), so they're left out of the AI
  // coach's own snapshot entirely rather than mislabelled - the Readiness
  // widget itself just shows whatever the latest reading is, stale or not.
  // Strain is unaffected here since it's live/continuous, not once-daily.
  return {
    recoveryScore: data.readinessDataIsFresh ? data.readiness.recoveryScore : null,
    hrvMs: data.readinessDataIsFresh ? (latest?.hrvMs ?? null) : null,
    restingHeartRate: data.readinessDataIsFresh ? (latest?.restingHeartRate ?? null) : null,
    strainScore: latest?.strain ?? null,
    recentAvgStrain: data.readiness.recentAvgStrain,
    sleepPerformance: data.readinessDataIsFresh ? (latest?.sleepPerformance ?? null) : null,
    weeklyDistanceKm: data.weeklyProgress.distanceKm,
    weeklyTargetKm: data.weeklyProgress.distanceTargetKm,
    phase: data.settings.phase ?? null,
    customRules: data.settings.customRules ?? null,
    hasRiddenToday: data.hasRiddenToday,
    todayDistanceKm: data.todayDistanceKm,
  };
}
