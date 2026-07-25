import { useState } from "react";
import ReadinessCard from "../components/coaching/ReadinessCard";
import PowerZonesCard from "../components/coaching/PowerZonesCard";
import TrainingPlanCard from "../components/coaching/TrainingPlanCard";
import CoachChatCard from "../components/coaching/CoachChatCard";
import CoachingWidget from "../components/coaching/CoachingWidget";
import { useCoachingData } from "../components/coaching/useCoachingData";
import type { CoachingWidgetId, CoachingWidgetRect, NarrativeInput } from "../components/coaching/types";
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
import { useRawSources } from "../utils/useRawSources";
import { computeCanvasHeight } from "../utils/useCanvasItem";
import SignInGate from "../components/shared/SignInGate";
import TabNav from "../components/shared/TabNav";
import PageHeader from "../components/shared/PageHeader";
import styles from "./CoachingPage.module.css";

const MIN_SIZE: Record<CoachingWidgetId, { minWidth: number; minHeight: number }> = {
  readiness: { minWidth: 260, minHeight: 180 },
  chat: { minWidth: 280, minHeight: 320 },
  trainingPlan: { minWidth: 260, minHeight: 240 },
  powerZones: { minWidth: 260, minHeight: 240 },
};

const DEFAULT_DESKTOP: Record<CoachingWidgetId, CoachingWidgetRect> = {
  readiness: { x: 0, y: 0, width: 340, height: 260 },
  chat: { x: 360, y: 0, width: 380, height: 460 },
  trainingPlan: { x: 0, y: 280, width: 340, height: 380 },
  powerZones: { x: 360, y: 480, width: 380, height: 380 },
};

const DEFAULT_MOBILE: Record<CoachingWidgetId, CoachingWidgetRect> = {
  readiness: { x: 0, y: 0, width: 320, height: 220 },
  chat: { x: 0, y: 240, width: 320, height: 420 },
  trainingPlan: { x: 0, y: 680, width: 320, height: 380 },
  powerZones: { x: 0, y: 1080, width: 320, height: 380 },
};

const WIDGET_IDS: CoachingWidgetId[] = ["readiness", "chat", "trainingPlan", "powerZones"];

// Freely-added catalog widgets cascade below whatever's already on the
// canvas (fixed cards included) rather than stacking at (0,0).
function nextWidgetPosition(existingBottoms: number[]): { x: number; y: number } {
  const bottom = existingBottoms.reduce((max, b) => Math.max(max, b), 0);
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

export default function CoachingPage() {
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
  const raw = useRawSources();
  const data = useCoachingData(raw);
  const dashboardData = useDashboardData(raw);
  const isMobile = useIsMobile();
  const [isResizing, setIsResizing] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);

  const rectFor = (id: CoachingWidgetId): CoachingWidgetRect => {
    const saved = data.status === "ready" ? data.settings.layout?.[id] : undefined;
    return saved ?? (isMobile ? DEFAULT_MOBILE[id] : DEFAULT_DESKTOP[id]);
  };

  const handleMove = (id: CoachingWidgetId, x: number, y: number) => {
    if (data.status !== "ready") return;
    const current = rectFor(id);
    data.saveSettings({ ...data.settings, layout: { ...data.settings.layout, [id]: { ...current, x, y } } });
  };

  const handleResize = (id: CoachingWidgetId, width: number, height: number) => {
    if (data.status !== "ready") return;
    const current = rectFor(id);
    data.saveSettings({ ...data.settings, layout: { ...data.settings.layout, [id]: { ...current, width, height } } });
  };

  const catalogWidgets: Widget[] = data.status === "ready" ? (data.settings.widgets ?? []) : [];
  const metricById = new Map((dashboardData.status === "ready" ? dashboardData.metrics : []).map((m) => [m.id, m]));

  const saveCatalogWidgets = (next: Widget[]) => {
    if (data.status !== "ready") return;
    data.saveSettings({ ...data.settings, widgets: next });
  };

  const handleAddMetric = (metric: MetricDef) => {
    const bottoms = [
      ...WIDGET_IDS.map((id) => rectFor(id).y + rectFor(id).height),
      ...catalogWidgets.map((w) => (w.y ?? 0) + (w.height ?? DEFAULT_WIDGET_HEIGHT)),
    ];
    const position = nextWidgetPosition(bottoms);
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
    saveCatalogWidgets([...catalogWidgets, widget]);
    setCatalogOpen(false);
  };

  const handleRemoveMetric = (id: string) => saveCatalogWidgets(catalogWidgets.filter((w) => w.id !== id));

  const handleMetricViewTypeChange = (id: string, viewType: Widget["viewType"]) =>
    saveCatalogWidgets(catalogWidgets.map((w) => (w.id === id ? { ...w, viewType } : w)));

  const handleMetricColorChange = (id: string, color: string) =>
    saveCatalogWidgets(catalogWidgets.map((w) => (w.id === id ? { ...w, color } : w)));

  const handleMetricLabelChange = (id: string, label: string) =>
    saveCatalogWidgets(catalogWidgets.map((w) => (w.id === id ? { ...w, label } : w)));

  const handleMetricMove = (id: string, x: number, y: number) =>
    saveCatalogWidgets(catalogWidgets.map((w) => (w.id === id ? { ...w, x, y } : w)));

  const handleMetricResize = (id: string, width: number, height: number) =>
    saveCatalogWidgets(catalogWidgets.map((w) => (w.id === id ? { ...w, width, height } : w)));

  const canvasHeight =
    data.status === "ready"
      ? computeCanvasHeight([
          ...WIDGET_IDS.map((id) => rectFor(id)),
          ...catalogWidgets.map((w) => ({
            y: w.y ?? 0,
            height: w.height ?? DEFAULT_WIDGET_HEIGHT,
          })),
        ])
      : 400;

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <TabNav
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Trends", href: "/dashboard/trends" },
            { label: "Coaching", href: "/dashboard/coaching", active: true },
            { label: "Settings", href: "/dashboard/settings" },
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
              <a href="/api/auth-logout" className={styles.switchLink}>
                Sign out
              </a>
            </>
          }
        />
      </div>

      <PageHeader title="Coaching" subtitle="Readiness, power zones, and training plan progress, built from your own data." />

      {catalogOpen && <div className={styles.catalogBackdrop} onClick={() => setCatalogOpen(false)} />}

      <aside className={`${styles.catalogDrawer} ${catalogOpen ? styles.catalogDrawerOpen : ""}`}>
        <DataCatalog metrics={dashboardData.status === "ready" ? dashboardData.metrics : []} onAdd={handleAddMetric} />
      </aside>

      {data.status === "loading" ? (
        <p className={styles.loading}>Loading…</p>
      ) : (
        <main className={`${styles.canvas} ${isResizing ? styles.canvasSnap : ""}`} style={{ height: canvasHeight }}>
          <CoachingWidget
            {...rectFor("readiness")}
            {...MIN_SIZE.readiness}
            onMove={(x, y) => handleMove("readiness", x, y)}
            onResize={(w, h) => handleResize("readiness", w, h)}
            onResizingChange={setIsResizing}
          >
            <ReadinessCard readiness={data.readiness} />
          </CoachingWidget>

          <CoachingWidget
            {...rectFor("chat")}
            {...MIN_SIZE.chat}
            onMove={(x, y) => handleMove("chat", x, y)}
            onResize={(w, h) => handleResize("chat", w, h)}
            onResizingChange={setIsResizing}
          >
            <CoachChatCard
              input={narrativeInputFrom(data)}
              settings={data.settings}
              onSaveSettings={data.saveSettings}
              dataAvailable={data.dataAvailable}
            />
          </CoachingWidget>

          <CoachingWidget
            {...rectFor("trainingPlan")}
            {...MIN_SIZE.trainingPlan}
            onMove={(x, y) => handleMove("trainingPlan", x, y)}
            onResize={(w, h) => handleResize("trainingPlan", w, h)}
            onResizingChange={setIsResizing}
          >
            <TrainingPlanCard settings={data.settings} onSaveSettings={data.saveSettings} weeklyProgress={data.weeklyProgress} />
          </CoachingWidget>

          <CoachingWidget
            {...rectFor("powerZones")}
            {...MIN_SIZE.powerZones}
            onMove={(x, y) => handleMove("powerZones", x, y)}
            onResize={(w, h) => handleResize("powerZones", w, h)}
            onResizingChange={setIsResizing}
          >
            <PowerZonesCard settings={data.settings} recentRides={data.recentRides} />
          </CoachingWidget>

          {catalogWidgets.map((widget) => (
            <DashboardWidget
              key={widget.id}
              widget={widget}
              metricById={metricById}
              whoopHistory={dashboardData.status === "ready" ? dashboardData.whoopHistory : []}
              onViewTypeChange={(viewType) => handleMetricViewTypeChange(widget.id, viewType)}
              onColorChange={(color) => handleMetricColorChange(widget.id, color)}
              onLabelChange={(label) => handleMetricLabelChange(widget.id, label)}
              onMove={(x, y) => handleMetricMove(widget.id, x, y)}
              onResize={(width, height) => handleMetricResize(widget.id, width, height)}
              onResizingChange={setIsResizing}
              onRemove={() => handleRemoveMetric(widget.id)}
            />
          ))}
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
