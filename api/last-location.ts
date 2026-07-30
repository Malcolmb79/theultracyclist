import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getJSON, setJSON } from "./_lib/kvStore.js";
import { getSessionEmail } from "./_lib/session.js";

/**
 * The athlete's last known coordinates, as reported by the dashboard.
 *
 * The weather card asks the *browser* where it is, which nothing rendered
 * server-side can do - so a WhatsApp weather image would otherwise be stuck
 * with a fixed location, wrong the moment the athlete travels. The dashboard
 * posts what geolocation gave it, and the image renderer reads that.
 *
 * Deliberately coarse and small: two rounded numbers and a place name, no
 * history. This is "where to ask about the weather", not a location log - a
 * trail of precise coordinates over time is a different and much more
 * sensitive thing to be storing.
 */

const KV_KEY = "LAST_KNOWN_LOCATION";

// ~1km of precision, which is all a weather lookup needs and keeps this from
// pinpointing an address.
const COORD_PRECISION = 2;

export type LastLocation = { latitude: number; longitude: number; place?: string; updatedAt: string };

export async function fetchLastLocation(): Promise<LastLocation | null> {
  return (await getJSON<LastLocation>(KV_KEY)) ?? null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!getSessionEmail(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (req.method === "POST") {
    const body = req.body as { latitude?: number; longitude?: number; place?: string };
    const { latitude, longitude } = body;
    if (
      typeof latitude !== "number" ||
      typeof longitude !== "number" ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180
    ) {
      res.status(400).json({ error: "Bad coordinates" });
      return;
    }

    const round = (n: number) => Math.round(n * 10 ** COORD_PRECISION) / 10 ** COORD_PRECISION;
    await setJSON(KV_KEY, {
      latitude: round(latitude),
      longitude: round(longitude),
      place: typeof body.place === "string" ? body.place.slice(0, 80) : undefined,
      updatedAt: new Date().toISOString(),
    } satisfies LastLocation);
    res.status(200).json({ ok: true });
    return;
  }

  res.status(200).json({ location: await fetchLastLocation() });
}
