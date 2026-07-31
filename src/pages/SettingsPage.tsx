import { useEffect, useState } from "react";
import { useAuthSession } from "../utils/useAuthSession";
import { useUnits } from "../context/UnitsContext";
import { useTheme, type ThemeMode } from "../context/ThemeContext";
import { useDashboardTheme } from "../utils/useDashboardTheme";
import { convertValueUnit, type UnitSystem } from "../utils/units";
import { readImageFile } from "../utils/resizeImage";
import { fetchRoute } from "../utils/gpxRoute";
import { DEFAULT_CALORIE_BURN_ESTIMATE } from "../utils/estimateCalorieBurn";
import type { CoachingSettings } from "../components/coaching/types";
import SignInGate from "../components/shared/SignInGate";
import PasskeysSection from "../components/settings/PasskeysSection";
import RidePhotosSection from "../components/settings/RidePhotosSection";
import PortraitSection from "../components/settings/PortraitSection";
import CoachKnowledgeSection from "../components/settings/CoachKnowledgeSection";
import TabNav from "../components/shared/TabNav";
import GoalsEditor from "../components/trends/GoalsEditor";
import type { Goals } from "../components/trends/types";
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

// <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" in the browser's
// own local time, with no timezone suffix - converts a stored ISO string to
// that shape (and back again on save via new Date(value).toISOString()).
function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function SettingsEditor() {
  // Goals live in their own KV record rather than in coaching settings, so
  // they load and save independently of everything else on this page.
  const [goals, setGoals] = useState<Goals>({});

  useEffect(() => {
    fetch("/api/trends-goals")
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => setGoals(body?.goals ?? {}))
      .catch(() => setGoals({}));
  }, []);

  const handleSaveGoals = async (next: Goals) => {
    await fetch("/api/trends-goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    setGoals(next);
  };

  const { system, setSystem } = useUnits();
  const { mode, setMode } = useTheme();
  const distanceUnit = convertValueUnit(1, "km", system).unit;

  const [settings, setSettings] = useState<CoachingSettings | null>(null);
  const [ftpInput, setFtpInput] = useState("");
  const [heightInput, setHeightInput] = useState("");
  const [distanceInput, setDistanceInput] = useState("");
  const [hoursInput, setHoursInput] = useState("");
  const [caloriesBurnWakeTimeInput, setCaloriesBurnWakeTimeInput] = useState(DEFAULT_CALORIE_BURN_ESTIMATE.wakeTime);
  const [caloriesBurnTargetInput, setCaloriesBurnTargetInput] = useState(
    DEFAULT_CALORIE_BURN_ESTIMATE.dailyTargetKcal.toString(),
  );
  const [caloriesBurnTargetTimeInput, setCaloriesBurnTargetTimeInput] = useState(DEFAULT_CALORIE_BURN_ESTIMATE.targetTime);
  const [saving, setSaving] = useState<"ftp" | "height" | "targets" | "garmin" | "liveTracker" | "caloriesBurn" | null>(
    null,
  );
  const [garminUrlInput, setGarminUrlInput] = useState("");
  const [gpxUrlInput, setGpxUrlInput] = useState("");
  const [positionFeedUrlInput, setPositionFeedUrlInput] = useState("");
  const [targetHoursInput, setTargetHoursInput] = useState("18");
  const [targetMinutesInput, setTargetMinutesInput] = useState("0");
  const [startTimeInput, setStartTimeInput] = useState("");
  const [showLivePageInput, setShowLivePageInput] = useState(true);
  const [liveTrackerStatus, setLiveTrackerStatus] = useState<string | null>(null);
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
        setGarminUrlInput(s.garminLiveTrackUrl ?? "");
        setCaloriesBurnWakeTimeInput(s.caloriesBurnWakeTime ?? DEFAULT_CALORIE_BURN_ESTIMATE.wakeTime);
        setCaloriesBurnTargetInput((s.caloriesBurnTarget ?? DEFAULT_CALORIE_BURN_ESTIMATE.dailyTargetKcal).toString());
        setCaloriesBurnTargetTimeInput(s.caloriesBurnTargetTime ?? DEFAULT_CALORIE_BURN_ESTIMATE.targetTime);
      })
      .catch(() => {
        if (!cancelled) setSettings({});
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/live-tracker")
      .then((res) => res.json())
      .then(
        (body: {
          gpxUrl: string | null;
          positionFeedUrl?: string;
          targetSeconds: number | null;
          startTime: string | null;
          visible?: boolean;
        }) => {
          if (cancelled) return;
          setGpxUrlInput(body.gpxUrl ?? "");
          setPositionFeedUrlInput(body.positionFeedUrl ?? "");
          setTargetHoursInput(body.targetSeconds != null ? Math.floor(body.targetSeconds / 3600).toString() : "");
          setTargetMinutesInput(body.targetSeconds != null ? Math.floor((body.targetSeconds % 3600) / 60).toString() : "");
          setStartTimeInput(body.startTime ? toDatetimeLocalValue(body.startTime) : "");
          setShowLivePageInput(body.visible ?? true);
        },
      )
      .catch(() => {});
    return () => {
      cancelled = true;
    };
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

  const handleSaveGarminUrl = async () => {
    if (!settings) return;
    setSaving("garmin");
    try {
      await persist({ ...settings, garminLiveTrackUrl: garminUrlInput.trim() === "" ? undefined : garminUrlInput.trim() });
    } finally {
      setSaving(null);
    }
  };

  const handleSaveCaloriesBurnEstimate = async () => {
    if (!settings) return;
    setSaving("caloriesBurn");
    try {
      await persist({
        ...settings,
        caloriesBurnWakeTime: caloriesBurnWakeTimeInput || undefined,
        caloriesBurnTarget: caloriesBurnTargetInput === "" ? undefined : Number(caloriesBurnTargetInput),
        caloriesBurnTargetTime: caloriesBurnTargetTimeInput || undefined,
      });
    } finally {
      setSaving(null);
    }
  };

  const liveTrackerPayload = (extra?: { resetHistory: boolean }) => {
    const hours = Number(targetHoursInput) || 0;
    const minutes = Number(targetMinutesInput) || 0;
    return {
      gpxUrl: gpxUrlInput.trim() || undefined,
      positionFeedUrl: positionFeedUrlInput.trim() || undefined,
      targetSeconds: hours || minutes ? hours * 3600 + minutes * 60 : undefined,
      startTime: startTimeInput ? new Date(startTimeInput).toISOString() : undefined,
      visible: showLivePageInput,
      ...extra,
    };
  };

  const handleSaveLiveTracker = async () => {
    setSaving("liveTracker");
    setLiveTrackerStatus(null);
    try {
      await fetch("/api/live-tracker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(liveTrackerPayload()),
      });
      setLiveTrackerStatus("Saved.");
    } finally {
      setSaving(null);
    }
  };

  const handleResetLiveTrackerHistory = async () => {
    setSaving("liveTracker");
    setLiveTrackerStatus(null);
    try {
      await fetch("/api/live-tracker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(liveTrackerPayload({ resetHistory: true })),
      });
      setLiveTrackerStatus("Position history cleared - ready for a fresh start.");
    } finally {
      setSaving(null);
    }
  };

  // Starts a live-advancing simulation for testing /live before a real
  // inReach device/feed exists - the server (api/live-tracker.ts) computes
  // an actually-moving position on every poll from this config, sped up
  // 120x real time so an ~18h ride finishes in about 9 real minutes. Paced
  // at the target pace itself (not artificially faster) so the simulated
  // run takes close to the full target duration, matching what a real
  // ~18h attempt would look like. "Reset position history" stops it.
  const handleSimulateTestRun = async () => {
    if (!gpxUrlInput.trim()) {
      setLiveTrackerStatus("Add a route GPX URL first.");
      return;
    }
    setSaving("liveTracker");
    setLiveTrackerStatus(null);
    try {
      const route = await fetchRoute(gpxUrlInput.trim());
      const totalKm = route.length > 0 ? route[route.length - 1].distanceKm : 0;
      if (totalKm === 0) throw new Error("empty route");

      const targetSeconds = (Number(targetHoursInput) || 18) * 3600 + (Number(targetMinutesInput) || 0) * 60;
      const simulatedKmh = totalKm / (targetSeconds / 3600);

      await fetch("/api/live-tracker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...liveTrackerPayload(),
          targetSeconds,
          simulation: { startedAtMs: Date.now(), kmh: simulatedKmh },
        }),
      });
      setLiveTrackerStatus("Simulation running - open /live and watch it advance (sped up ~120x, finishes in a few minutes).");
    } catch {
      setLiveTrackerStatus("Couldn't start the simulation - make sure the route URL is public and valid.");
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
          <p className={styles.sectionTitle}>Coach knowledge</p>
          <p className={styles.sectionHint}>
            Training plans, protocols, notes from your coach. The AI coach searches this when a question touches
            it and is told to prefer it over generic advice — so it shapes the answers you get, on the dashboard
            and over WhatsApp.
          </p>
          <CoachKnowledgeSection />
        </div>

        <div className={styles.section}>
          <p className={styles.sectionTitle}>About portrait</p>
          <p className={styles.sectionHint}>
            The photo beside your story on the public About page. This one is public - unlike the profile picture
            above, which only appears in your own menu. Leave it unset to keep the placeholder illustration.
          </p>
          <PortraitSection />
        </div>

        <div className={styles.section}>
          <p className={styles.sectionTitle}>Ride photos</p>
          <p className={styles.sectionHint}>
            Pick which photos from a Strava ride to keep. Chosen photos are copied here rather than linked, because
            Strava's own photo links expire. Nothing appears on the public ride feed unless you tick it.
          </p>
          <RidePhotosSection />
        </div>

        <div className={styles.section}>
          <p className={styles.sectionTitle}>Passkeys</p>
          <p className={styles.sectionHint}>
            Sign in with Face ID, Touch ID, Windows Hello or a security key instead of a password. Register one per
            device you want to sign in from — they only work on this domain, not on Vercel preview URLs.
          </p>
          <PasskeysSection />
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
          <p className={styles.sectionTitle}>Goals</p>
          <p className={styles.sectionHint}>
            Targets, and when you mean to reach them. A goal with a date can be judged on whether it&apos;s on track;
            one without can only be judged on whether it&apos;s been reached. Add these as widgets from the Trends
            page.
          </p>
          <GoalsEditor goals={goals} onSave={handleSaveGoals} />
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
          <p className={styles.sectionTitle}>Estimated calorie burn</p>
          <p className={styles.sectionHint}>
            The Calories Balance widget shows this live estimate for today's "Burned" figure whenever Apple Health
            hasn't synced a real Active/Basal Energy reading for today yet - a straight-line ramp from 0 at wake time
            up to your coach's daily target by the time below, clearly labelled as an estimate. It's replaced by the
            real synced number the moment Apple Health catches up.
          </p>
          <div className={styles.targetInputs}>
            <label className={styles.targetLabel}>
              Wake time
              <input
                type="time"
                className={styles.input}
                value={caloriesBurnWakeTimeInput}
                onChange={(e) => setCaloriesBurnWakeTimeInput(e.target.value)}
              />
            </label>
            <label className={styles.targetLabel}>
              Daily target
              <div className={styles.inputRow}>
                <input
                  type="number"
                  className={styles.input}
                  value={caloriesBurnTargetInput}
                  onChange={(e) => setCaloriesBurnTargetInput(e.target.value)}
                  placeholder="kcal"
                />
                <span className={styles.inputUnit}>kcal</span>
              </div>
            </label>
            <label className={styles.targetLabel}>
              Reached by
              <input
                type="time"
                className={styles.input}
                value={caloriesBurnTargetTimeInput}
                onChange={(e) => setCaloriesBurnTargetTimeInput(e.target.value)}
              />
            </label>
          </div>
          <button
            type="button"
            className={styles.saveButton}
            onClick={handleSaveCaloriesBurnEstimate}
            disabled={saving === "caloriesBurn" || !settings}
          >
            {saving === "caloriesBurn" ? "Saving…" : "Save"}
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

        <div className={styles.section}>
          <p className={styles.sectionTitle}>Garmin LiveTrack</p>
          <p className={styles.sectionHint}>
            Garmin generates a new LiveTrack link every time you start one on your device - paste the current one
            here before a ride to show live position on the Garmin LiveTrack widget. There's no way to detect this
            automatically, so it needs updating each time.
          </p>
          <input
            type="text"
            className={`${styles.input} ${styles.inputWide}`}
            value={garminUrlInput}
            onChange={(e) => setGarminUrlInput(e.target.value)}
            placeholder="https://livetrack.garmin.com/session/..."
          />
          <button
            type="button"
            className={styles.saveButton}
            onClick={handleSaveGarminUrl}
            disabled={saving === "garmin" || !settings}
          >
            {saving === "garmin" ? "Saving…" : "Save"}
          </button>
        </div>

        <div className={styles.section}>
          <p className={styles.sectionTitle}>Live Tracker (public page)</p>
          <p className={styles.sectionHint}>
            Powers the public /live page followers watch during the attempt itself - separate from the Garmin
            LiveTrack widget above. Set these once before the attempt starts.
          </p>

          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={showLivePageInput}
              onChange={(e) => setShowLivePageInput(e.target.checked)}
            />
            Show live page to visitors
          </label>
          <p className={styles.sectionHint}>
            Turn off to hide /live from everyone but you - your route, target, and feed stay saved, so you can turn
            it back on later without re-entering anything. You can still preview the real page yourself while it&apos;s
            hidden.
          </p>

          <p className={styles.sectionHint} style={{ marginTop: "var(--space-2)" }}>
            Route URL - a Ride with GPS route&apos;s public .json link (make the route public first, then just
            append .json to its normal URL - RWGPS&apos;s .gpx export needs login even for public routes, but .json
            doesn&apos;t). Plain public GPX files also work.
          </p>
          <input
            type="text"
            className={`${styles.input} ${styles.inputWide}`}
            value={gpxUrlInput}
            onChange={(e) => setGpxUrlInput(e.target.value)}
            placeholder="https://ridewithgps.com/routes/XXXXXXX.json"
          />

          <p className={styles.sectionHint} style={{ marginTop: "var(--space-2)" }}>
            Garmin inReach MapShare KML feed URL (Explore/inReach account &rarr; Social &rarr; MapShare &rarr; Feeds)
          </p>
          <input
            type="text"
            className={`${styles.input} ${styles.inputWide}`}
            value={positionFeedUrlInput}
            onChange={(e) => setPositionFeedUrlInput(e.target.value)}
            placeholder="https://share.garmin.com/Feed/Share/..."
          />

          <p className={styles.sectionHint} style={{ marginTop: "var(--space-2)" }}>
            Target time
          </p>
          <div className={styles.inputRow}>
            <input
              type="number"
              className={styles.input}
              value={targetHoursInput}
              onChange={(e) => setTargetHoursInput(e.target.value)}
              placeholder="hours"
            />
            <span className={styles.inputUnit}>h</span>
            <input
              type="number"
              className={styles.input}
              value={targetMinutesInput}
              onChange={(e) => setTargetMinutesInput(e.target.value)}
              placeholder="minutes"
            />
            <span className={styles.inputUnit}>m</span>
          </div>

          <p className={styles.sectionHint} style={{ marginTop: "var(--space-2)" }}>
            Attempt start time
          </p>
          <input
            type="datetime-local"
            className={`${styles.input} ${styles.inputWide}`}
            value={startTimeInput}
            onChange={(e) => setStartTimeInput(e.target.value)}
          />

          {liveTrackerStatus && <p className={styles.statusOk}>{liveTrackerStatus}</p>}
          <div className={styles.pictureActions} style={{ marginTop: "var(--space-2)" }}>
            <button
              type="button"
              className={styles.saveButton}
              onClick={handleSaveLiveTracker}
              disabled={saving === "liveTracker"}
            >
              {saving === "liveTracker" ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className={styles.removeButton}
              onClick={handleSimulateTestRun}
              disabled={saving === "liveTracker"}
            >
              Simulate a test run
            </button>
            <button
              type="button"
              className={styles.removeButton}
              onClick={handleResetLiveTrackerHistory}
              disabled={saving === "liveTracker"}
            >
              Reset position history
            </button>
          </div>
        </div>
      </div>

      {cropperImage && (
        <ImageCropper image={cropperImage} onCancel={() => setCropperImage(null)} onConfirm={handleCropConfirm} />
      )}
    </div>
  );
}
