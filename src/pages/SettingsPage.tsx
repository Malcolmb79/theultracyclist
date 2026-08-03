import { useEffect, useState } from "react";
import { useAuthSession } from "../utils/useAuthSession";
import { useUnits } from "../context/UnitsContext";
import { useTheme, type ThemeMode } from "../context/ThemeContext";
import { useDashboardTheme } from "../utils/useDashboardTheme";
import { convertValueUnit, type UnitSystem } from "../utils/units";
import { readImageFile } from "../utils/resizeImage";
import { DEFAULT_CALORIE_BURN_ESTIMATE } from "../utils/estimateCalorieBurn";
import type { CoachingSettings } from "../components/coaching/types";
import SignInGate from "../components/shared/SignInGate";
import PasskeysSection from "../components/settings/PasskeysSection";
import RidePhotosSection from "../components/settings/RidePhotosSection";
import PortraitSection from "../components/settings/PortraitSection";
import SitePhotosSection from "../components/settings/SitePhotosSection";
import CoachKnowledgeSection from "../components/settings/CoachKnowledgeSection";
import DateRangePicker from "../components/shared/DateRangePicker";
import {
  PAGE_RANGE_FALLBACK,
  type DashboardPage as DashboardPageId,
  type DateRangeId,
} from "../utils/dateRange";
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

// Dashboard first, matching the tab order the athlete already navigates by.
const PAGE_RANGE_ORDER: { page: DashboardPageId; label: string }[] = [
  { page: "dashboard", label: "Dashboard" },
  { page: "trends", label: "Trends" },
  { page: "coaching", label: "Coaching" },
];

type TpEvent = { date: string; title: string; tss?: number; tssEstimated?: boolean };
type TpReconcileRow = {
  date: string;
  planned: { title: string; tss: number | null; estimated: boolean } | null;
  recorded: { rides: number; tss: number | null; noPower: boolean } | null;
  verdict: "match" | "missing-here" | "extra-here" | "no-power" | "none";
};

// Why a day's training load differs between the two, in the athlete's words
// rather than a status code.
const RECONCILE_WORDING: Record<TpReconcileRow["verdict"], string> = {
  match: "both have it",
  "missing-here": "in TrainingPeaks, nothing on Strava",
  "extra-here": "on Strava, not on the TrainingPeaks calendar",
  "no-power": "ride recorded without power, so it adds no TSS here",
  none: "nothing either side",
};

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
  const [saving, setSaving] = useState<
    | "ftp"
    | "height"
    | "targets"
    | "garmin"
    | "liveTracker"
    | "caloriesBurn"
    | "trainingPeaks"
    // Not a save - the one destructive action on this page. It shares this
    // state so it can't run while a save is in flight, and vice versa.
    | "clearRideData"
    | null
  >(
    null,
  );
  const [garminUrlInput, setGarminUrlInput] = useState("");
  const [tpUrlInput, setTpUrlInput] = useState("");
  const [tpCookieInput, setTpCookieInput] = useState("");
  const [tpConn, setTpConn] = useState<
    | { status: "unknown" }
    | { status: "saving" }
    | { status: "done"; configured: boolean; authExpired?: boolean; error?: string; counts?: Record<string, number> }
  >({ status: "unknown" });
  const [tpCheck, setTpCheck] = useState<
    | { status: "idle" }
    | { status: "checking" }
    | { status: "done"; events: TpEvent[]; reconcile?: TpReconcileRow[]; error?: string }
  >({ status: "idle" });
  const [gpxUrlInput, setGpxUrlInput] = useState("");
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
        setTpUrlInput(s.trainingPeaksIcsUrl ?? "");
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
          targetSeconds: number | null;
          startTime: string | null;
          visible?: boolean;
        }) => {
          if (cancelled) return;
          setGpxUrlInput(body.gpxUrl ?? "");
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

  const handleSaveTrainingPeaksCookie = async () => {
    setTpConn({ status: "saving" });
    const res = await fetch("/api/trainingpeaks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cookie: tpCookieInput.trim() || null }),
    });
    const body = (await res.json()) as { configured?: boolean; authExpired?: boolean; error?: string; counts?: Record<string, number> };
    // Cleared from the field the moment it is stored - a session credential
    // has no reason to sit in a text box afterwards.
    setTpCookieInput("");
    setTpConn({ status: "done", configured: !!body.configured, authExpired: body.authExpired, error: body.error, counts: body.counts });
  };

  const handleSaveTrainingPeaksUrl = async () => {
    if (!settings) return;
    setSaving("trainingPeaks");
    try {
      await persist({ ...settings, trainingPeaksIcsUrl: tpUrlInput.trim() === "" ? undefined : tpUrlInput.trim() });
      // Read it straight back so the athlete sees what the feed actually
      // contains rather than a "Saved" that proves nothing.
      setTpCheck({ status: "checking" });
      const res = await fetch("/api/trainingpeaks-calendar?refresh=1&reconcile=1");
      const body = (await res.json()) as { events?: TpEvent[]; reconcile?: TpReconcileRow[]; error?: string };
      setTpCheck({ status: "done", events: body.events ?? [], reconcile: body.reconcile, error: body.error });
    } finally {
      setSaving(null);
    }
  };

  const handleSavePageDateRange = async (page: DashboardPageId, id: DateRangeId) => {
    if (!settings) return;
    await persist({ ...settings, pageDateRanges: { ...settings.pageDateRanges, [page]: id } });
  };

  const liveTrackerPayload = () => {
    const hours = Number(targetHoursInput) || 0;
    const minutes = Number(targetMinutesInput) || 0;
    return {
      gpxUrl: gpxUrlInput.trim() || undefined,
      targetSeconds: hours || minutes ? hours * 3600 + minutes * 60 : undefined,
      startTime: startTimeInput ? new Date(startTimeInput).toISOString() : undefined,
      visible: showLivePageInput,
    };
  };

  // Irreversible, so it asks first. The confirmation belongs here rather
  // than in the endpoint: a server that asks "are you sure?" over HTTP has
  // only moved the problem, and this is the one destructive control on the
  // page - everything else either saves or toggles.
  const handleClearRideData = async () => {
    const confirmed = window.confirm(
      "Clear all tracker data?\n\n" +
        "Every recorded position and reading is deleted permanently, and the public live page goes back to blank. " +
        "This cannot be undone.",
    );
    if (!confirmed) return;

    setSaving("clearRideData");
    setLiveTrackerStatus(null);
    try {
      const res = await fetch("/api/tracker-reset", { method: "POST" });
      const body = (await res.json().catch(() => null)) as { deleted?: number; error?: string } | null;
      setLiveTrackerStatus(
        res.ok
          ? `Cleared ${body?.deleted ?? 0} recorded ${body?.deleted === 1 ? "sample" : "samples"}. The live page is blank.`
          : (body?.error ?? "Couldn't clear the data."),
      );
    } catch {
      setLiveTrackerStatus("Couldn't reach the server - nothing was cleared.");
    } finally {
      setSaving(null);
    }
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
          <p className={styles.sectionTitle}>Date ranges</p>
          <p className={styles.sectionHint}>
            The window each page&apos;s widgets show by default. A widget can override this for itself — grab its
            resize handle and pick a range — and anything left on &quot;Use Dashboard Settings&quot; follows the
            page it sits on.
          </p>
          {PAGE_RANGE_ORDER.map(({ page, label }) => (
            <div key={page} className={styles.field}>
              <DateRangePicker
                allowInherit={false}
                label={label}
                value={{ id: settings?.pageDateRanges?.[page] ?? PAGE_RANGE_FALLBACK[page] }}
                onChange={(next) => handleSavePageDateRange(page, next.id)}
              />
            </div>
          ))}
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
          <p className={styles.sectionTitle}>Home page photos</p>
          <p className={styles.sectionHint}>
            The two photographs on the public home page. Both are published the moment you save them. They're resized
            in the browser before upload, so pick the best version you have rather than a small one.
          </p>
          <SitePhotosSection />
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
          <p className={styles.sectionTitle}>TrainingPeaks connection</p>
          <p className={styles.sectionHint}>
            Connects the AI coach directly to TrainingPeaks, which then <strong>overrides</strong> anything this
            app infers: your real CTL/ATL/TSB rather than the figures built from Strava power alone, your real
            Annual Training Plan rather than the copy in the code, and real planned TSS rather than an estimate
            from a workout&apos;s title. Paste your <code>Production_tpAuth</code> cookie from a signed-in
            TrainingPeaks tab (DevTools &rarr; Application &rarr; Cookies). It is stored write-only, never shown
            again and never put in a prompt &mdash; but it is a long-lived key to your whole TrainingPeaks
            account, so treat it like a password. It expires periodically and will need re-pasting.
          </p>
          <input
            type="password"
            autoComplete="off"
            className={`${styles.input} ${styles.inputWide}`}
            value={tpCookieInput}
            onChange={(e) => setTpCookieInput(e.target.value)}
            placeholder="Production_tpAuth cookie value"
          />
          <button
            type="button"
            className={styles.saveButton}
            onClick={handleSaveTrainingPeaksCookie}
            disabled={tpConn.status === "saving"}
          >
            {tpConn.status === "saving" ? "Connecting…" : "Connect"}
          </button>
          {tpConn.status === "done" && (
            <p className={styles.sectionHint}>
              {!tpConn.configured
                ? "Disconnected. The coach will fall back to figures derived from Strava."
                : tpConn.authExpired
                  ? "That cookie was rejected — it has probably expired. Copy a fresh one and try again."
                  : tpConn.error
                    ? `Connected, but TrainingPeaks returned an error: ${tpConn.error}`
                    : `Connected. Read ${tpConn.counts?.fitness ?? 0} days of fitness, ${tpConn.counts?.atp ?? 0} ATP weeks and ${tpConn.counts?.workouts ?? 0} workouts.`}
            </p>
          )}
        </div>

        <div className={styles.section}>
          <p className={styles.sectionTitle}>TrainingPeaks calendar</p>
          <p className={styles.sectionHint}>
            TrainingPeaks has no personal API, so a Premium calendar feed is the only way to pull your planned
            workouts in automatically. In TrainingPeaks go to Settings &rarr; Calendar Sync and copy the .ics link,
            then paste it here. Two caveats worth knowing: the feed only reaches{" "}
            <strong>14 days ahead</strong> and can lag the app by up to a day, and TrainingPeaks does not put
            planned TSS in it at all &mdash; so load is estimated from each session&apos;s length unless you write
            &quot;TSS 85&quot; into the workout title or description, which is read exactly.
          </p>
          <input
            type="text"
            className={`${styles.input} ${styles.inputWide}`}
            value={tpUrlInput}
            onChange={(e) => setTpUrlInput(e.target.value)}
            placeholder="webcal://www.trainingpeaks.com/ical/..."
          />
          <button
            type="button"
            className={styles.saveButton}
            onClick={handleSaveTrainingPeaksUrl}
            disabled={saving === "trainingPeaks" || !settings}
          >
            {saving === "trainingPeaks" ? "Saving…" : "Save and check"}
          </button>
          {tpCheck.status === "checking" && <p className={styles.sectionHint}>Reading the calendar…</p>}
          {tpCheck.status === "done" && (
            tpCheck.error ? (
              <p className={styles.sectionHint}>Couldn&apos;t read that feed: {tpCheck.error}</p>
            ) : tpCheck.events.length === 0 ? (
              <p className={styles.sectionHint}>
                The feed loaded but held no workouts. TrainingPeaks only publishes 5 days back and 14 forward, so
                an empty fortnight reads the same as a wrong link.
              </p>
            ) : (
              <>
                <p className={styles.sectionHint}>
                  Found {tpCheck.events.length} workout{tpCheck.events.length === 1 ? "" : "s"}:
                </p>
                <ul className={styles.plainList}>
                  {tpCheck.events.slice(0, 8).map((e, i) => (
                    <li key={i}>
                      {e.date} — {e.title}
                      {e.tss != null && ` · ${e.tss} TSS${e.tssEstimated ? " (estimated)" : ""}`}
                    </li>
                  ))}
                </ul>
              </>
            )
          )}
          {tpCheck.status === "done" && tpCheck.reconcile && tpCheck.reconcile.length > 0 && (
            <>
              <p className={styles.sectionHint}>
                Last {tpCheck.reconcile.length} days, TrainingPeaks against what this app recorded from Strava. A
                day only TrainingPeaks knows about is a day your CTL here is missing load it has &mdash; which is
                what makes the two numbers drift apart.
              </p>
              <ul className={styles.plainList}>
                {tpCheck.reconcile.map((row) => (
                  <li key={row.date}>
                    {row.date} — {row.planned ? `${row.planned.title}` : "—"}
                    {" · "}
                    {row.recorded
                      ? `Strava ${row.recorded.rides} ride${row.recorded.rides === 1 ? "" : "s"}${
                          row.recorded.tss != null ? `, ${row.recorded.tss} TSS` : ""
                        }`
                      : "nothing on Strava"}
                    {" · "}
                    <strong>{RECONCILE_WORDING[row.verdict]}</strong>
                  </li>
                ))}
              </ul>
            </>
          )}
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
            Turn off to hide /live from everyone but you - your route and target stay saved, so you can turn
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
            {/* Set apart from Save, and styled as destructive, because the
                two do opposite things and sit a few pixels apart. */}
            <button
              type="button"
              className={styles.dangerButton}
              onClick={handleClearRideData}
              disabled={saving === "clearRideData"}
            >
              {saving === "clearRideData" ? "Clearing…" : "Clear ride data"}
            </button>
          </div>
          <p className={styles.fieldHint}>
            Deletes every recorded position and reading, so the live page starts blank for the attempt. Can&apos;t be
            undone.
          </p>
        </div>
      </div>

      {cropperImage && (
        <ImageCropper image={cropperImage} onCancel={() => setCropperImage(null)} onConfirm={handleCropConfirm} />
      )}
    </div>
  );
}
