import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getJSON, setJSON } from "./_lib/kvStore.js";
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
type CoachingWidgetEntry = {
  id: string;
  kind: "readiness" | "chat" | "trainingPlan" | "powerZones" | "metric";
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
};

const KV_KEY = "COACHING_SETTINGS";

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
    weeklyDistanceKm: stored.weeklyDistanceKm,
    weeklyHours: stored.weeklyHours,
    phase: stored.phase,
    customRules: stored.customRules,
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
    const stored = (await getJSON<StoredSettings>(KV_KEY)) ?? readLegacySettings();

    const widgetsByDevice = mergeDeviceLayout<CoachingWidgetEntry>(
      stored.widgetsByDevice ?? stored.widgets ?? [],
      device,
      incoming.widgets ?? [],
    );

    const next: StoredSettings = {
      ftpWatts: incoming.ftpWatts,
      heightCm: incoming.heightCm,
      weeklyDistanceKm: incoming.weeklyDistanceKm,
      weeklyHours: incoming.weeklyHours,
      phase: incoming.phase,
      customRules: incoming.customRules,
      widgetsByDevice,
    };
    await setJSON(KV_KEY, next);
    res.status(200).json({ ok: true });
    return;
  }

  const stored = (await getJSON<StoredSettings>(KV_KEY)) ?? readLegacySettings();
  const widgets = resolveDeviceLayout<CoachingWidgetEntry>(stored.widgetsByDevice ?? stored.widgets ?? [], device);
  const settings: CoachingSettings = {
    ftpWatts: stored.ftpWatts,
    heightCm: stored.heightCm,
    weeklyDistanceKm: stored.weeklyDistanceKm,
    weeklyHours: stored.weeklyHours,
    phase: stored.phase,
    customRules: stored.customRules,
    widgets,
  };
  res.status(200).json({ settings });
}
