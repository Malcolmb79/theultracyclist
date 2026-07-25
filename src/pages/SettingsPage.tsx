import { useEffect, useState } from "react";
import { useAuthSession } from "../utils/useAuthSession";
import { useUnits } from "../context/UnitsContext";
import { convertValueUnit, type UnitSystem } from "../utils/units";
import type { CoachingSettings } from "../components/coaching/types";
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

function roundTo1(value: number): number {
  return Math.round(value * 10) / 10;
}

function SettingsEditor() {
  const { system, setSystem } = useUnits();
  const distanceUnit = convertValueUnit(1, "km", system).unit;

  const [settings, setSettings] = useState<CoachingSettings | null>(null);
  const [ftpInput, setFtpInput] = useState("");
  const [distanceInput, setDistanceInput] = useState("");
  const [hoursInput, setHoursInput] = useState("");
  const [saving, setSaving] = useState<"ftp" | "targets" | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/coaching-settings")
      .then((res) => res.json())
      .then((body: { settings: CoachingSettings }) => {
        if (cancelled) return;
        const s = body.settings ?? {};
        setSettings(s);
        setFtpInput(s.ftpWatts?.toString() ?? "");
        setDistanceInput(
          s.weeklyDistanceKm != null
            ? roundTo1(convertValueUnit(s.weeklyDistanceKm, "km", system).value).toString()
            : "",
        );
        setHoursInput(s.weeklyHours?.toString() ?? "");
      })
      .catch(() => {
        if (!cancelled) setSettings({});
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = async (next: CoachingSettings) => {
    await fetch("/api/coaching-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    setSettings(next);
  };

  const handleSaveFtp = async () => {
    if (!settings) return;
    setSaving("ftp");
    try {
      await persist({ ...settings, ftpWatts: ftpInput === "" ? undefined : Number(ftpInput) });
    } finally {
      setSaving(null);
    }
  };

  const handleSaveTargets = async () => {
    if (!settings) return;
    setSaving("targets");
    try {
      const enteredDistance = distanceInput === "" ? undefined : Number(distanceInput);
      await persist({
        ...settings,
        weeklyDistanceKm:
          enteredDistance == null ? undefined : convertValueUnit(enteredDistance, distanceUnit, "metric").value,
        weeklyHours: hoursInput === "" ? undefined : Number(hoursInput),
      });
    } finally {
      setSaving(null);
    }
  };

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

        <div className={styles.section}>
          <p className={styles.sectionTitle}>FTP</p>
          <p className={styles.sectionHint}>Used to compute your power zones on the Coaching page.</p>
          <div className={styles.inputRow}>
            <input
              type="number"
              className={styles.input}
              value={ftpInput}
              onChange={(e) => setFtpInput(e.target.value)}
              placeholder="watts"
            />
            <span className={styles.inputUnit}>W</span>
          </div>
          <button
            type="button"
            className={styles.saveButton}
            onClick={handleSaveFtp}
            disabled={saving === "ftp" || !settings}
          >
            {saving === "ftp" ? "Saving…" : "Save"}
          </button>
        </div>

        <div className={styles.section}>
          <p className={styles.sectionTitle}>Weekly targets</p>
          <p className={styles.sectionHint}>Used for the training-plan progress bars on the Coaching page.</p>
          <div className={styles.targetInputs}>
            <label className={styles.targetLabel}>
              Distance
              <div className={styles.inputRow}>
                <input
                  type="number"
                  className={styles.input}
                  value={distanceInput}
                  onChange={(e) => setDistanceInput(e.target.value)}
                  placeholder={distanceUnit}
                />
                <span className={styles.inputUnit}>{distanceUnit}</span>
              </div>
            </label>
            <label className={styles.targetLabel}>
              Hours
              <div className={styles.inputRow}>
                <input
                  type="number"
                  className={styles.input}
                  value={hoursInput}
                  onChange={(e) => setHoursInput(e.target.value)}
                  placeholder="h"
                />
                <span className={styles.inputUnit}>h</span>
              </div>
            </label>
          </div>
          <button
            type="button"
            className={styles.saveButton}
            onClick={handleSaveTargets}
            disabled={saving === "targets" || !settings}
          >
            {saving === "targets" ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
