import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getJSON, readJSON, setJSON } from "./_lib/kvStore.js";
import { getSessionEmail } from "./_lib/session.js";
import { isDeviceCategory, mergeDeviceLayout, resolveDeviceLayout, type DeviceCategory } from "./_lib/deviceLayout.js";

export type Widget = {
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
  /**
   * Per-widget date window, stored opaquely - the browser owns the preset
   * vocabulary (src/utils/dateRange.ts) and this route only round-trips it.
   */
  dateRange?: { id: string; customStart?: string; customEnd?: string };
};

const KV_KEY = "DASHBOARD_LAYOUT";

// One-time migration fallback: this key used to live in a Vercel project
// env var (only visible after a redeploy - see _lib/vercelEnvStore.ts for
// why that caused lost updates). Until the first post-migration save lands
// in Redis, fall back to whatever's still in the env var so nothing saved
// before the cutover disappears.
function readLegacyLayout(): Widget[] {
  try {
    const raw = process.env.DASHBOARD_LAYOUT;
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Widget[]) : [];
  } catch {
    return [];
  }
}

function deviceFrom(req: VercelRequest): DeviceCategory {
  const value = (req.query.device as string | undefined) ?? (req.body as { device?: string } | undefined)?.device;
  return isDeviceCategory(value) ? value : "desktop";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!getSessionEmail(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const device = deviceFrom(req);

  if (req.method === "POST") {
    const widgets = (req.body as { widgets?: Widget[] }).widgets ?? [];
    // Refuse to save on top of a read we couldn't make. mergeDeviceLayout
    // keeps the other devices' layouts by copying them out of `stored`, so a
    // read that quietly returned "nothing" would write a record containing
    // only this device - turning a momentary Redis blip into a permanent loss
    // of every other device's arrangement.
    let stored: unknown;
    try {
      stored = (await readJSON<unknown>(KV_KEY)) ?? readLegacyLayout();
    } catch (error) {
      console.error("Refusing to save layout - could not read current state", error);
      res.status(503).json({ error: "Storage is unavailable right now - nothing was saved." });
      return;
    }
    await setJSON(KV_KEY, mergeDeviceLayout(stored, device, widgets));
    res.status(200).json({ ok: true });
    return;
  }

  const stored = (await getJSON<unknown>(KV_KEY)) ?? readLegacyLayout();
  const widgets = resolveDeviceLayout<Widget>(stored, device);
  res.status(200).json({ widgets });
}
