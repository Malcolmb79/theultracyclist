import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getJSON, readJSON, setJSON } from "./_lib/kvStore.js";
import { getSessionEmail } from "./_lib/session.js";
import { isDeviceCategory, mergeDeviceLayout, resolveDeviceLayout, type DeviceCategory } from "./_lib/deviceLayout.js";

export type TrendsWidget = {
  id: string;
  metric: string;
  label: string;
  viewType: "day" | "week" | "month" | "calendar";
  color?: string;
  x?: number;
  y?: number;
  /** See dashboard-layout.ts's Widget.dateRange - same shape, round-tripped. */
  dateRange?: { id: string; customStart?: string; customEnd?: string };
  width?: number;
  height?: number;
};

const KV_KEY = "TRENDS_LAYOUT";

// One-time migration fallback - see dashboard-layout.ts for why.
function readLegacyLayout(): TrendsWidget[] {
  try {
    const raw = process.env.TRENDS_LAYOUT;
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as TrendsWidget[]) : [];
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
    const widgets = (req.body as { widgets?: TrendsWidget[] }).widgets ?? [];
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
  const widgets = resolveDeviceLayout<TrendsWidget>(stored, device);
  res.status(200).json({ widgets });
}
