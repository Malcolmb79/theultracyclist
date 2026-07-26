import { useState } from "react";
import ReadinessCard from "../components/coaching/ReadinessCard";
import PowerZonesCard from "../components/coaching/PowerZonesCard";
import TrainingPlanCard from "../components/coaching/TrainingPlanCard";
import CoachChatCard from "../components/coaching/CoachChatCard";
import CoachingWidget from "../components/coaching/CoachingWidget";
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
  type Widget,
} from "../components/dashboard/types";
import type { MetricDef } from "../components/dashboard/useDashboardData";
import { useAuthSession } from "../utils/useAuthSession";
import { useIsMobile } from "../utils/useIsMobile";
import { useDeviceCategory } from "../utils/useDeviceCategory";
import { useDashboardTheme } from "../utils/useDashboardTheme";
import { useRawSources } from "../utils/useRawSources";
import { computeCanvasHeight } from "../utils/useCanvasItem";
import SignInGate from "../components/shared/SignInGate";
import TabNav from "../components/shared/TabNav";
import PageHeader from "../components/shared/PageHeader";
import ProfileMenu from "../components/shared/ProfileMenu";
import styles from "./CoachingPage.module.css";

type Rect = { x: number; y: number; width: number; height: number };

const MIN_SIZE: Record<FixedCardKind, { minWidth: number; minHeight: number }> = {
  readiness: { minWidth: 260, minHeight: 180 },
  chat: { minWidth: 280, minHeight: 320 },
  trainingPlan: { minWidth: 260, minHeight: 240 },
  powerZones: { minWidth: 260, minHeight: 240 },
};

const DEFAULT_DESKTOP: Record<FixedCardKind, Rect> = {
  readiness: { x: 0, y: 0, width: 340, height: 260 },
  chat: { x: 360, y: 0, width: 380, height: 460 },
  trainingPlan: { x: 0, y: 280, width: 340, height: 380 },
  powerZones: { x: 360, y: 480, width: 380, height: 380 },
};

const DEFAULT_MOBILE: Record<FixedCardKind, Rect> = {
  readiness: { x: 0, y: 0, width: 320, height: 220 },
  chat: { x: 0, y: 240, width: 320, height: 420 },
  trainingPlan: { x: 0, y: 680, width: 320, height: 380 },
  powerZones: { x: 0, y: 1080, width: 320, height: 380 },
};

const FIXED_CARD_ORDER: FixedCardKind[] = ["readiness", "chat", "trainingPlan", "powerZones"];

// Normalizes whatever's actually stored into today's shape:
//  - Entries saved before the unified widget list existed (the "kind"
//    field didn't exist yet) were always metric widgets - the metric
//    catalog is the only thing that used to be saved under `widgets`.
//  - The 4 fixed cards used to live in a separate `layout` field that no
//    longer exists at all, so on a pre-migration save none of them show up
//    here - seed whichever are missing at their default position rather
//    than assuming "present in this list" is the only way a fixed card
//    can exist. This also covers a genuinely first-ever load (empty list).
function normalizeWidgets(raw: CoachingWidgetEntry[], isMobile: boolean): CoachingWidgetEntry[] {
  const normalized = raw.map((w) => (w.kind ? w : { ...w, kind: "metric" as const }));
  const missingCards = FIXED_CARD_ORDER.filter((kind) => !normalized.some((w) => w.kind === kind));
  if (missingCards.length === 0) return normalized;
  const defaults = isMobile ? DEFAULT_MOBILE : DEFAULT_DESKTOP;
  const seeded = missingCards.map((kind) => ({ id: kind, kind, label: FIXED_CARD_LABELS[kind], ...defaults[kind] }));
  return [...seeded, ...normalized];
}

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

  const widgets: CoachingWidgetEntry[] = data.status === "ready" ? normalizeWidgets(data.settings.widgets ?? [], isMobile) : [];
  const metricById = new Map((dashboardData.status === "ready" ? dashboardData.metrics : []).map((m) => [m.id, m]));
  const missingFixedCards = FIXED_CARD_ORDER.filter((kind) => !widgets.some((w) => w.kind === kind));

  const saveWidgets = (next: CoachingWidgetEntry[]) => {
    if (data.status !== "ready") return;
    data.saveSettings({ ...data.settings, widgets: next });
  };

  const handleAddFixedCard = (kind: FixedCardKind) => {
    const position = nextWidgetPosition(widgets);
    const defaults = isMobile ? DEFAULT_MOBILE[kind] : DEFAULT_DESKTOP[kind];
    const entry: CoachingWidgetEntry = {
      id: kind,
      kind,
      label: FIXED_CARD_LABELS[kind],
      x: position.x,
      y: position.y,
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

  const canvasHeight =
    data.status === "ready"
      ? computeCanvasHeight(widgets.map((w) => ({ y: w.y ?? 0, height: w.height ?? DEFAULT_WIDGET_HEIGHT })))
      : 400;

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <TabNav
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Trends", href: "/dashboard/trends" },
            { label: "Coaching", href: "/dashboard/coaching", active: true },
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
  return {
    recoveryScore: data.readiness.recoveryScore,
    hrvMs: latest?.hrvMs ?? null,
    restingHeartRate: latest?.restingHeartRate ?? null,
    strainScore: latest?.strain ?? null,
    recentAvgStrain: data.readiness.recentAvgStrain,
    sleepPerformance: latest?.sleepPerformance ?? null,
    weeklyDistanceKm: data.weeklyProgress.distanceKm,
    weeklyTargetKm: data.weeklyProgress.distanceTargetKm,
    phase: data.settings.phase ?? null,
    customRules: data.settings.customRules ?? null,
    hasRiddenToday: data.hasRiddenToday,
    todayDistanceKm: data.todayDistanceKm,
  };
}
