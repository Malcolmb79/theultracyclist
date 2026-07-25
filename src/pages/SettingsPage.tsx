import { useAuthSession } from "../utils/useAuthSession";
import { useUnits } from "../context/UnitsContext";
import type { UnitSystem } from "../utils/units";
import SignInGate from "../components/shared/SignInGate";
import TabNav from "../components/shared/TabNav";
import PageHeader from "../components/shared/PageHeader";
import styles from "./SettingsPage.module.css";

export default function SettingsPage() {
  const auth = useAuthSession();

  if (auth.status === "loading") {
    return (
      <div className={styles.page}>
        <p className={styles.loading}>Loading…</p>
      </div>
    );
  }

  if (auth.status === "signed-out") {
    return <SignInGate title="Settings" />;
  }

  return <SettingsEditor />;
}

function SettingsEditor() {
  const { system, setSystem } = useUnits();

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <TabNav
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Trends", href: "/dashboard/trends" },
            { label: "Coaching", href: "/dashboard/coaching" },
            { label: "Settings", href: "/dashboard/settings", active: true },
          ]}
          trailing={
            <a href="/api/auth-logout" className={styles.switchLink}>
              Sign out
            </a>
          }
        />
      </div>

      <PageHeader title="Settings" subtitle="Preferences for the dashboard, trends, and coaching pages." />

      <div className={styles.content}>
        <div className={styles.section}>
          <p className={styles.sectionTitle}>Units</p>
          <p className={styles.sectionHint}>
            Applies to distance, elevation, and weight across Dashboard, Trends, and Coaching.
          </p>
          <div className={styles.segmented} role="radiogroup" aria-label="Unit system">
            {(["metric", "imperial"] as UnitSystem[]).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={system === option}
                className={[styles.segmentButton, system === option ? styles.segmentButtonActive : ""].join(" ")}
                onClick={() => setSystem(option)}
              >
                {option === "metric" ? "Metric" : "Imperial"}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
