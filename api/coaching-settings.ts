import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getJSON, readJSON, setJSON } from "./_lib/kvStore.js";
import { getSessionEmail } from "./_lib/session.js";
import { isDeviceCategory, mergeDeviceLayout, resolveDeviceLayout, type DeviceCategory } from "./_lib/deviceLayout.js";

// Mirrors the client-side CoachingWidgetEntry (src/components/coaching/types.ts) -
// independent local copy, matching how this project keeps the frontend and
// api/ TypeScript projects decoupled (see coaching-narrative.ts's
// NarrativeInput for the same pattern). A single flat list covering both the
// 4 fixed cards (kind !== "metric") and freely-added catalog widgets (kind
// === "metric") is what lets add/remove/resize/move/reorder work the same
// way for every widget on the page, instead of the 4 fixed cards living in
// a separate non-removable `layout` record.
type FixedCardKind = "readiness" | "chat" | "trainingPlan" | "powerZones" | "trainingCalendar";

type CoachingWidgetEntry = {
  id: string;
  kind: FixedCardKind | "metric";
  source?: "strava" | "whoop" | "health";
  metric?: string;
  viewType?: "stat" | "chart" | "timeline" | "ring" | "combo" | "rings" | "healthCalendar" | "caloriesBalance";
  label: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  color?: string;
};

export type CoachingSettings = {
  ftpWatts?: number;
  // Metric or imperial, as chosen in Settings. Persisted server-side rather
  // than only in the browser because things rendered away from the browser
  // need it too - a WhatsApp widget image has no localStorage to read, and
  // was showing kilograms to an athlete reading in pounds.
  unitSystem?: "metric" | "imperial";
  // Always centimeters - see the client-side CoachingSettings type for why.
  heightCm?: number;
  weeklyDistanceKm?: number;
  weeklyHours?: number;
  phase?: "build" | "recovery" | "taper";
  widgets?: CoachingWidgetEntry[];
  // Free-text standing instructions the athlete sets once (dietary
  // restrictions, injuries, tone preferences, anything else) - folded into
  // every coach prompt (see buildSystemPrompt in coaching-chat.ts and
  // buildPrompt in coaching-narrative.ts) rather than needing to be repeated.
  customRules?: string;
  // A small (~160px) square JPEG the athlete uploaded, already resized and
  // encoded client-side (see src/utils/resizeImage.ts) - stored directly as
  // a data URL rather than in separate file storage, since it's small
  // enough to just live alongside the rest of this settings blob and this
  // app has no other use for a file storage integration.
  profilePictureDataUrl?: string;
  // Pasted before a ride/the attempt itself, not auto-discovered - Garmin
  // generates a new LiveTrack session URL each time one is started, and
  // there's no documented API to look one up automatically. Embedded
  // directly as an iframe src client-side (src/components/dashboard/
  // GarminLiveTrackCard.tsx) rather than fetched through this API - Garmin's
  // internal LiveTrack data endpoint sits behind CSRF protection a
  // stateless server request can't satisfy.
  garminLiveTrackUrl?: string;
  // Drives the Calories Balance widget's live "estimated" burn fallback for
  // today - see the client-side CoachingSettings type (src/components/
  // coaching/types.ts) for the full explanation. Passed through as-is;
  // this route has no logic of its own around these three fields.
  caloriesBurnWakeTime?: string;
  caloriesBurnTarget?: number;
  caloriesBurnTargetTime?: string;
  /**
   * Default date window per page ("dashboard" | "trends" | "coaching"), set in
   * Settings. Shared across devices rather than per-device like the widget
   * lists: it is a reading preference, not a layout, and an athlete who wants
   * Trends on 90 days wants that on the phone too.
   */
  pageDateRanges?: Record<string, string>;
  /** TrainingPeaks Premium calendar feed URL - see api/trainingpeaks-calendar.ts. */
  trainingPeaksIcsUrl?: string;
};

// KV shape: profile fields (ftpWatts, heightCm, ...) are shared across every
// device, but the widget list is per-device (phone/tablet/PC each arrange
// their own cards - see api/_lib/deviceLayout.ts) so moving cards around on
// mobile doesn't touch the desktop arrangement. `widgets` (no "ByDevice"
// suffix) is the pre-device-scoping shape, kept only as a one-time
// migration source, same as dashboard-layout.ts/trends-layout.ts.
type StoredSettings = Omit<CoachingSettings, "widgets"> & {
  widgetsByDevice?: Partial<Record<DeviceCategory, CoachingWidgetEntry[]>>;
  widgets?: CoachingWidgetEntry[];
  // Set once a device's widget list has been normalized into today's shape
  // (see migrateWidgets below) - after that, a fixed card missing from the
  // list means the athlete removed it on purpose, and it must never be
  // silently re-added again. Without this flag, resolving "is this fixed
  // card missing because it was never migrated, or because someone just
  // removed it?" from the array alone is ambiguous, and re-seeding on every
  // read would make removing a fixed card impossible - it'd reappear on
  // the very next fetch.
  fixedCardsMigrated?: boolean;
};

const KV_KEY = "COACHING_SETTINGS";

const FIXED_CARD_ORDER: FixedCardKind[] = ["readiness", "chat", "trainingPlan", "powerZones"];

const FIXED_CARD_LABELS: Record<FixedCardKind, string> = {
  readiness: "Today's Readiness",
  chat: "AI Coach",
  trainingPlan: "Training Plan",
  powerZones: "Power Zones",
};

type Rect = { x: number; y: number; width: number; height: number };

// Mirrors CoachingPage.tsx's DEFAULT_DESKTOP/DEFAULT_MOBILE - only used to
// seed a device's very first migration (see migrateWidgets), so this only
// needs to be roughly right, not kept in perfect lockstep with the client.
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

// One-time normalization for a device's widget list: backfills "kind" on
// entries saved before the unified list existed (they were always metric
// widgets - the catalog is the only thing that used to be saved under
// `widgets`), and seeds whichever of the 4 fixed cards are missing (their
// old positions lived in a `layout` field that no longer exists at all, so
// pre-migration data never has them in this list). Only ever called when
// `fixedCardsMigrated` isn't set yet - see that field's comment for why.
function migrateWidgets(raw: CoachingWidgetEntry[], device: DeviceCategory): CoachingWidgetEntry[] {
  const normalized = raw.map((w) => (w.kind ? w : { ...w, kind: "metric" as const }));
  const missing = FIXED_CARD_ORDER.filter((kind) => !normalized.some((w) => w.kind === kind));
  if (missing.length === 0) return normalized;
  const defaults = device === "mobile" ? DEFAULT_MOBILE : DEFAULT_DESKTOP;
  const seeded = missing.map((kind) => ({ id: kind, kind, label: FIXED_CARD_LABELS[kind], ...defaults[kind] }));
  return [...seeded, ...normalized];
}

// One-time migration fallback - see dashboard-layout.ts for why.
function readLegacySettings(): StoredSettings {
  try {
    const raw = process.env.COACHING_SETTINGS;
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as StoredSettings) : {};
  } catch {
    return {};
  }
}

function deviceFrom(req: VercelRequest): DeviceCategory {
  const value = (req.query.device as string | undefined) ?? (req.body as { device?: string } | undefined)?.device;
  return isDeviceCategory(value) ? value : "desktop";
}

// The shared (non-device-scoped) profile fields only - reusable by anything
// that needs the athlete's FTP/phase/weekly targets/standing rules without
// a request/response pair to hang a `device` query param off of (see
// api/_lib/coachSnapshot.ts, used by the WhatsApp webhook).
export async function fetchCoachingSettings(): Promise<CoachingSettings> {
  const stored = (await getJSON<StoredSettings>(KV_KEY)) ?? readLegacySettings();
  return {
    ftpWatts: stored.ftpWatts,
    heightCm: stored.heightCm,
    unitSystem: stored.unitSystem,
    weeklyDistanceKm: stored.weeklyDistanceKm,
    weeklyHours: stored.weeklyHours,
    phase: stored.phase,
    customRules: stored.customRules,
    profilePictureDataUrl: stored.profilePictureDataUrl,
    garminLiveTrackUrl: stored.garminLiveTrackUrl,
    caloriesBurnWakeTime: stored.caloriesBurnWakeTime,
    caloriesBurnTarget: stored.caloriesBurnTarget,
    caloriesBurnTargetTime: stored.caloriesBurnTargetTime,
    pageDateRanges: stored.pageDateRanges,
    trainingPeaksIcsUrl: stored.trainingPeaksIcsUrl,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!getSessionEmail(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const device = deviceFrom(req);

  if (req.method === "POST") {
    const incoming = (req.body ?? {}) as CoachingSettings;
    // Refuse to save on top of a read we couldn't make. mergeDeviceLayout
    // keeps the other devices' layouts by copying them out of `stored`, so a
    // read that quietly returned "nothing" would write a record containing
    // only this device - turning a momentary Redis blip into a permanent loss
    // of every other device's arrangement.
    let stored: StoredSettings;
    try {
      stored = (await readJSON<StoredSettings>(KV_KEY)) ?? readLegacySettings();
    } catch (error) {
      console.error("Refusing to save layout - could not read current state", error);
      res.status(503).json({ error: "Storage is unavailable right now - nothing was saved." });
      return;
    }

    const widgetsByDevice = mergeDeviceLayout<CoachingWidgetEntry>(
      stored.widgetsByDevice ?? stored.widgets ?? [],
      device,
      incoming.widgets ?? [],
    );

    const next: StoredSettings = {
      ftpWatts: incoming.ftpWatts,
      heightCm: incoming.heightCm,
      unitSystem: incoming.unitSystem,
      weeklyDistanceKm: incoming.weeklyDistanceKm,
      weeklyHours: incoming.weeklyHours,
      phase: incoming.phase,
      customRules: incoming.customRules,
      profilePictureDataUrl: incoming.profilePictureDataUrl,
      garminLiveTrackUrl: incoming.garminLiveTrackUrl,
      caloriesBurnWakeTime: incoming.caloriesBurnWakeTime,
      caloriesBurnTarget: incoming.caloriesBurnTarget,
      caloriesBurnTargetTime: incoming.caloriesBurnTargetTime,
      pageDateRanges: incoming.pageDateRanges,
      trainingPeaksIcsUrl: incoming.trainingPeaksIcsUrl,
      widgetsByDevice,
      // A save from today's client always sends an already-migrated list
      // (or a deliberately-emptied one) - either way, the array is now the
      // source of truth and must never be auto-reseeded again.
      fixedCardsMigrated: true,
    };
    await setJSON(KV_KEY, next);
    res.status(200).json({ ok: true });
    return;
  }

  const stored = (await getJSON<StoredSettings>(KV_KEY)) ?? readLegacySettings();
  let widgets = resolveDeviceLayout<CoachingWidgetEntry>(stored.widgetsByDevice ?? stored.widgets ?? [], device);
  let fixedCardsMigrated = stored.fixedCardsMigrated ?? false;

  if (!fixedCardsMigrated) {
    widgets = migrateWidgets(widgets, device);
    const widgetsByDevice = mergeDeviceLayout<CoachingWidgetEntry>(
      stored.widgetsByDevice ?? stored.widgets ?? [],
      device,
      widgets,
    );
    fixedCardsMigrated = true;
    await setJSON(KV_KEY, { ...stored, widgets: undefined, widgetsByDevice, fixedCardsMigrated });
  }

  const settings: CoachingSettings = {
    ftpWatts: stored.ftpWatts,
    heightCm: stored.heightCm,
    unitSystem: stored.unitSystem,
    weeklyDistanceKm: stored.weeklyDistanceKm,
    weeklyHours: stored.weeklyHours,
    phase: stored.phase,
    customRules: stored.customRules,
    profilePictureDataUrl: stored.profilePictureDataUrl,
    garminLiveTrackUrl: stored.garminLiveTrackUrl,
    caloriesBurnWakeTime: stored.caloriesBurnWakeTime,
    caloriesBurnTarget: stored.caloriesBurnTarget,
    caloriesBurnTargetTime: stored.caloriesBurnTargetTime,
    pageDateRanges: stored.pageDateRanges,
    trainingPeaksIcsUrl: stored.trainingPeaksIcsUrl,
    widgets,
  };
  res.status(200).json({ settings });
}
