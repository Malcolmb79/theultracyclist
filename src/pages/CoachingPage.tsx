import { useState } from "react";
import ReadinessCard from "../components/coaching/ReadinessCard";
import PowerZonesCard from "../components/coaching/PowerZonesCard";
import TrainingPlanCard from "../components/coaching/TrainingPlanCard";
import AINarrativeCard from "../components/coaching/AINarrativeCard";
import { useCoachingData } from "../components/coaching/useCoachingData";
import type { NarrativeInput } from "../components/coaching/types";
import styles from "./CoachingPage.module.css";

const STORAGE_KEY = "dashboard-password";

function useUnlock() {
  const [password, setPassword] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);

  const submit = async () => {
    setChecking(true);
    setError(false);
    try {
      const res = await fetch("/api/dashboard-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: input }),
      });
      if (res.ok) {
        localStorage.setItem(STORAGE_KEY, input);
        setPassword(input);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setChecking(false);
    }
  };

  return { password, input, setInput, error, checking, submit };
}

export default function CoachingPage() {
  const { password, input, setInput, error, checking, submit } = useUnlock();

  if (!password) {
    return (
      <div className={styles.gate}>
        <div className={styles.gateBox}>
          <h1 className={styles.gateTitle}>Coaching</h1>
          <input
            type="password"
            className={styles.gateInput}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Password"
            autoFocus
          />
          <button type="button" className={styles.gateButton} onClick={submit} disabled={checking}>
            {checking ? "Checking…" : "Unlock"}
          </button>
          {error && <p className={styles.gateError}>Incorrect password.</p>}
        </div>
      </div>
    );
  }

  return <CoachingView password={password} />;
}

function CoachingView({ password }: { password: string }) {
  const data = useCoachingData(password);

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <a href="/dashboard" className={styles.switchLink}>
          Main dashboard
        </a>
        <a href="/dashboard/trends" className={styles.switchLink}>
          Trends
        </a>
      </div>

      <div className={styles.header}>
        <h1 className={styles.title}>Coaching</h1>
        <p className={styles.subtitle}>Readiness, power zones, and training plan progress, built from your own data.</p>
      </div>

      {data.status === "loading" ? (
        <p className={styles.loading}>Loading…</p>
      ) : (
        <div className={styles.grid}>
          <ReadinessCard readiness={data.readiness} />
          <AINarrativeCard password={password} input={narrativeInputFrom(data)} />
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
