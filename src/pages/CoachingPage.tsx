import ReadinessCard from "../components/coaching/ReadinessCard";
import PowerZonesCard from "../components/coaching/PowerZonesCard";
import TrainingPlanCard from "../components/coaching/TrainingPlanCard";
import AINarrativeCard from "../components/coaching/AINarrativeCard";
import { useCoachingData } from "../components/coaching/useCoachingData";
import type { NarrativeInput } from "../components/coaching/types";
import { useAuthSession } from "../utils/useAuthSession";
import SignInGate from "../components/shared/SignInGate";
import TabNav from "../components/shared/TabNav";
import PageHeader from "../components/shared/PageHeader";
import styles from "./CoachingPage.module.css";

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
        <div className={styles.grid}>
          <ReadinessCard readiness={data.readiness} />
          <AINarrativeCard input={narrativeInputFrom(data)} />
          <TrainingPlanCard settings={data.settings} onSaveSettings={data.saveSettings} weeklyProgress={data.weeklyProgress} />
          <PowerZonesCard settings={data.settings} onSaveSettings={data.saveSettings} recentRides={data.recentRides} />
        </div>
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
