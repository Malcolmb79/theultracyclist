import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getJSON, setJSON } from "./_lib/kvStore.js";
import { getSessionEmail } from "./_lib/session.js";
import { isDeviceCategory, mergeDeviceLayout, resolveDeviceLayout, type DeviceCategory } from "./_lib/deviceLayout.js";

type CoachingWidgetRect = { x: number; y: number; width: number; height: number };
type CardLayout = Partial<Record<"readiness" | "chat" | "trainingPlan" | "powerZones", CoachingWidgetRect>>;

// Mirrors dashboard's Widget type (src/components/dashboard/types.ts) -
// independent local copy, matching how this project keeps the frontend and
// api/ TypeScript projects decoupled (see coaching-narrative.ts's
// NarrativeInput for the same pattern).
type CatalogWidget = {
  id: string;
  source: "strava" | "whoop" | "health";
  metric: string;
  label: string;
  viewType: "stat" | "chart" | "timeline" | "ring" | "combo" | "rings";
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
  layout?: CardLayout;
  widgets?: CatalogWidget[];
  // Free-text standing instructions the athlete sets once (dietary
  // restrictions, injuries, tone preferences, anything else) - folded into
  // every coach prompt (see buildSystemPrompt in coaching-chat.ts and
  // buildPrompt in coaching-narrative.ts) rather than needing to be repeated.
  customRules?: string;
};

// KV shape: profile fields (ftpWatts, heightCm, ...) are shared across every
// device, but layout/widgets are per-device (phone/tablet/PC each arrange
// their own cards - see api/_lib/deviceLayout.ts) so moving cards around on
// mobile doesn't touch the desktop arrangement. `layout`/`widgets` (no
// "ByDevice" suffix) are the pre-device-scoping shape, kept only as a
// one-time migration source - see resolveLayout/mergeDeviceLayout below.
type StoredSettings = Omit<CoachingSettings, "layout" | "widgets"> & {
  layoutByDevice?: Partial<Record<DeviceCategory, CardLayout>>;
  widgetsByDevice?: Partial<Record<DeviceCategory, CatalogWidget[]>>;
  layout?: CardLayout;
  widgets?: CatalogWidget[];
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

// Same device -> desktop -> tablet -> mobile fallback as resolveDeviceLayout
// in deviceLayout.ts, just for a single record value (the fixed cards'
// rects) instead of an array of catalog widgets.
function resolveLayout(stored: StoredSettings, device: DeviceCategory): CardLayout {
  if (stored.layoutByDevice) {
    return (
      stored.layoutByDevice[device] ??
      stored.layoutByDevice.desktop ??
      stored.layoutByDevice.tablet ??
      stored.layoutByDevice.mobile ??
      {}
    );
  }
  return stored.layout ?? {};
}

function mergeLayout(stored: StoredSettings, device: DeviceCategory, next: CardLayout): Partial<Record<DeviceCategory, CardLayout>> {
  if (stored.layoutByDevice) return { ...stored.layoutByDevice, [device]: next };
  if (stored.layout) return { desktop: stored.layout, [device]: next };
  return { [device]: next };
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

    const widgetsByDevice = mergeDeviceLayout<CatalogWidget>(
      stored.widgetsByDevice ?? stored.widgets ?? [],
      device,
      incoming.widgets ?? [],
    );
    const layoutByDevice = mergeLayout(stored, device, incoming.layout ?? {});

    const next: StoredSettings = {
      ftpWatts: incoming.ftpWatts,
      heightCm: incoming.heightCm,
      weeklyDistanceKm: incoming.weeklyDistanceKm,
      weeklyHours: incoming.weeklyHours,
      phase: incoming.phase,
      customRules: incoming.customRules,
      widgetsByDevice,
      layoutByDevice,
    };
    await setJSON(KV_KEY, next);
    res.status(200).json({ ok: true });
    return;
  }

  const stored = (await getJSON<StoredSettings>(KV_KEY)) ?? readLegacySettings();
  const widgets = resolveDeviceLayout<CatalogWidget>(stored.widgetsByDevice ?? stored.widgets ?? [], device);
  const layout = resolveLayout(stored, device);
  const settings: CoachingSettings = {
    ftpWatts: stored.ftpWatts,
    heightCm: stored.heightCm,
    weeklyDistanceKm: stored.weeklyDistanceKm,
    weeklyHours: stored.weeklyHours,
    phase: stored.phase,
    customRules: stored.customRules,
    widgets,
    layout,
  };
  res.status(200).json({ settings });
}
