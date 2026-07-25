import { useState } from "react";
import ReadinessCard from "../components/coaching/ReadinessCard";
import PowerZonesCard from "../components/coaching/PowerZonesCard";
import TrainingPlanCard from "../components/coaching/TrainingPlanCard";
import CoachChatCard from "../components/coaching/CoachChatCard";
import CoachingWidget from "../components/coaching/CoachingWidget";
import { useCoachingData } from "../components/coaching/useCoachingData";
import type { CoachingWidgetId, CoachingWidgetRect, NarrativeInput } from "../components/coaching/types";
import { useAuthSession } from "../utils/useAuthSession";
import { useIsMobile } from "../utils/useIsMobile";
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
  const data = useCoachingData();
  const isMobile = useIsMobile();
  const [isResizing, setIsResizing] = useState(false);

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

  const canvasHeight =
    data.status === "ready" ? computeCanvasHeight(WIDGET_IDS.map((id) => rectFor(id))) : 400;

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
            <a href="/api/auth-logout" className={styles.switchLink}>
              Sign out
            </a>
          }
        />
      </div>

      <PageHeader title="Coaching" subtitle="Readiness, power zones, and training plan progress, built from your own data." />

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
            <CoachChatCard input={narrativeInputFrom(data)} />
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
            <PowerZonesCard settings={data.settings} onSaveSettings={data.saveSettings} recentRides={data.recentRides} />
          </CoachingWidget>
        </main>
      )}
    </div>
  );
}

function narrativeInputFrom(data: Extract<ReturnType<typeof useCoachingData>, { status: "ready" }>): NarrativeInput {
  return {
    recoveryScore: data.readiness.recoveryScore,
    hrvMs: null,
    restingHeartRate: null,
    strainScore: data.recoveryHistory.at(-1)?.strain ?? null,
    recentAvgStrain: data.readiness.recentAvgStrain,
    sleepPerformance: null,
    weeklyDistanceKm: data.weeklyProgress.distanceKm,
    weeklyTargetKm: data.weeklyProgress.distanceTargetKm,
    phase: data.settings.phase ?? null,
  };
}
