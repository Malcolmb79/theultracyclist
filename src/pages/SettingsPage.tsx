import { useEffect, useState } from "react";
import { useAuthSession } from "../utils/useAuthSession";
import { useUnits } from "../context/UnitsContext";
import { useTheme, type ThemeMode } from "../context/ThemeContext";
import { useDashboardTheme } from "../utils/useDashboardTheme";
import { convertValueUnit, type UnitSystem } from "../utils/units";
import { readImageFile } from "../utils/resizeImage";
import type { CoachingSettings } from "../components/coaching/types";
import SignInGate from "../components/shared/SignInGate";
import TabNav from "../components/shared/TabNav";
import PageHeader from "../components/shared/PageHeader";
import ProfileMenu from "../components/shared/ProfileMenu";
import ImageCropper from "../components/settings/ImageCropper";
import styles from "./SettingsPage.module.css";

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "auto", label: "Auto (sunrise/sunset)" },
];

export default function SettingsPage() {
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
    return <SignInGate title="Settings" />;
  }

  return <SettingsEditor />;
}

function roundTo1(value: number): number {
  return Math.round(value * 10) / 10;
}

function whoopStatusFromQuery(): "connected" | "failed" | null {
  const value = new URLSearchParams(window.location.search).get("whoop");
  return value === "connected" || value === "failed" ? value : null;
}

function SettingsEditor() {
  const { system, setSystem } = useUnits();
  const { mode, setMode } = useTheme();
  const distanceUnit = convertValueUnit(1, "km", system).unit;

  const [settings, setSettings] = useState<CoachingSettings | null>(null);
  const [ftpInput, setFtpInput] = useState("");
  const [heightInput, setHeightInput] = useState("");
  const [distanceInput, setDistanceInput] = useState("");
  const [hoursInput, setHoursInput] = useState("");
  const [saving, setSaving] = useState<"ftp" | "height" | "targets" | null>(null);
  const [whoopStatus] = useState(whoopStatusFromQuery);
  const [pictureDataUrl, setPictureDataUrl] = useState<string | undefined>(undefined);
  const [pictureError, setPictureError] = useState<string | null>(null);
  const [savingPicture, setSavingPicture] = useState(false);
  const [cropperImage, setCropperImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!whoopStatus) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("whoop");
    window.history.replaceState({}, "", url.toString());
    // Only strip the redirect param once, on mount - not on every whoopStatus read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/coaching-settings")
      .then((res) => res.json())
      .then((body: { settings: CoachingSettings }) => {
        if (cancelled) return;
        const s = body.settings ?? {};
        setSettings(s);
        setFtpInput(s.ftpWatts?.toString() ?? "");
        setHeightInput(s.heightCm?.toString() ?? "");
        setDistanceInput(
          s.weeklyDistanceKm != null
            ? roundTo1(convertValueUnit(s.weeklyDistanceKm, "km", system).value).toString()
            : "",
        );
        setHoursInput(s.weeklyHours?.toString() ?? "");
        setPictureDataUrl(s.profilePictureDataUrl);
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

  const handleSaveHeight = async () => {
    if (!settings) return;
    setSaving("height");
    try {
      await persist({ ...settings, heightCm: heightInput === "" ? undefined : Number(heightInput) });
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

  const handlePictureFile = async (file: File | undefined) => {
    if (!file) return;
    setPictureError(null);
    try {
      setCropperImage(await readImageFile(file));
    } catch {
      setPictureError("Couldn't read that image - try a different file.");
    }
  };

  const handleCropConfirm = (dataUrl: string) => {
    setPictureDataUrl(dataUrl);
    setCropperImage(null);
  };

  const handleSavePicture = async () => {
    if (!settings) return;
    setSavingPicture(true);
    try {
      await persist({ ...settings, profilePictureDataUrl: pictureDataUrl });
    } finally {
      setSavingPicture(false);
    }
  };

  const handleRemovePicture = async () => {
    if (!settings) return;
    setSavingPicture(true);
    try {
      setPictureDataUrl(undefined);
      await persist({ ...settings, profilePictureDataUrl: undefined });
    } finally {
      setSavingPicture(false);
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
          ]}
          trailing={<ProfileMenu />}
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
          <p className={styles.sectionTitle}>Appearance</p>
          <p className={styles.sectionHint}>
            Applies across Dashboard, Trends, Coaching, and Settings. Auto switches to light during the day and dark
            at night, based on sunrise/sunset at your location (falls back to Ireland if location access isn't
            available).
          </p>
          <div className={styles.segmented} role="radiogroup" aria-label="Theme">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={mode === option.value}
                className={[styles.segmentButton, mode === option.value ? styles.segmentButtonActive : ""].join(" ")}
                onClick={() => setMode(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.section}>
          <p className={styles.sectionTitle}>Profile picture</p>
          <p className={styles.sectionHint}>Shown in the profile menu at the top of every page.</p>
          <div className={styles.pictureRow}>
            {pictureDataUrl ? (
              <img src={pictureDataUrl} alt="" className={styles.picturePreview} />
            ) : (
              <div className={styles.picturePlaceholder} aria-hidden="true" />
            )}
            <div className={styles.pictureActions}>
              <label className={styles.uploadButton}>
                Choose photo
                <input
                  type="file"
                  accept="image/*"
                  className={styles.hiddenFileInput}
                  onChange={(e) => handlePictureFile(e.target.files?.[0])}
                />
              </label>
              {pictureDataUrl && (
                <button type="button" className={styles.removeButton} onClick={handleRemovePicture} disabled={savingPicture}>
                  Remove
                </button>
              )}
            </div>
          </div>
          {pictureError && <p className={styles.statusFail}>{pictureError}</p>}
          <button
            type="button"
            className={styles.saveButton}
            onClick={handleSavePicture}
            disabled={savingPicture || !settings || pictureDataUrl === settings?.profilePictureDataUrl}
          >
            {savingPicture ? "Saving…" : "Save"}
          </button>
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
          <p className={styles.sectionTitle}>Height</p>
          <p className={styles.sectionHint}>Used to compute the BMI widget, available on Dashboard, Trends, and Coaching.</p>
          <div className={styles.inputRow}>
            <input
              type="number"
              className={styles.input}
              value={heightInput}
              onChange={(e) => setHeightInput(e.target.value)}
              placeholder="cm"
            />
            <span className={styles.inputUnit}>cm</span>
          </div>
          <button
            type="button"
            className={styles.saveButton}
            onClick={handleSaveHeight}
            disabled={saving === "height" || !settings}
          >
            {saving === "height" ? "Saving…" : "Save"}
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

        <div className={styles.section}>
          <p className={styles.sectionTitle}>Connections</p>
          <p className={styles.sectionHint}>Reconnect a data source if its dashboard widgets go blank.</p>
          {whoopStatus === "connected" && <p className={styles.statusOk}>Whoop reconnected.</p>}
          {whoopStatus === "failed" && <p className={styles.statusFail}>Couldn't reconnect Whoop - try again.</p>}
          <a href="/api/whoop-authorize" className={styles.connectButton}>
            Reconnect Whoop
          </a>
        </div>
      </div>

      {cropperImage && (
        <ImageCropper image={cropperImage} onCancel={() => setCropperImage(null)} onConfirm={handleCropConfirm} />
      )}
    </div>
  );
}
