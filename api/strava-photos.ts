import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getJSON, setJSON } from "./_lib/kvStore.js";
import { getSessionEmail } from "./_lib/session.js";
import { getAccessToken } from "./strava-activities.js";

/**
 * Ride photos: browse what Strava holds for an activity, keep the chosen ones,
 * and optionally show them on the public ride feed.
 *
 * Selected photos are copied into KV as data URLs rather than referenced by
 * URL. Strava's photo URLs are signed and expire, so a stored URL would work
 * for a while and then quietly turn into a broken image - and re-fetching them
 * on every page load would put the public site's traffic against a
 * rate-limited API, using a token public visitors have no business triggering.
 *
 * Browsing and saving need a session. Reading saved photos does not, because
 * the public feed renders them - but only for rides explicitly marked public.
 */

const KV_KEY = "RIDE_PHOTOS";

// A ride's worth of pictures, not an album. Each is a ~600px JPEG, so base64
// puts a full ride at roughly a megabyte - fine for a handful of rides in KV,
// not fine unbounded.
const MAX_PHOTOS_PER_RIDE = 6;
const MAX_RIDES = 40;
// Strava sizes the image for us; asking for the display size keeps the stored
// bytes down without a resize step on this side.
const PHOTO_SIZE = 600;
// Refuses anything larger rather than storing a surprise - a phone panorama
// through a permissive CDN would otherwise land whole in KV.
const MAX_PHOTO_BYTES = 900_000;

/**
 * The server fetches URLs the client hands it, so the host has to be checked:
 * without this, `save` is an open proxy that will fetch any internal address
 * on request. Strava serves photos from its own domains and a CloudFront
 * distribution.
 */
const ALLOWED_PHOTO_HOSTS = [/(^|\.)strava\.com$/i, /(^|\.)cloudfront\.net$/i];

function isAllowedPhotoUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    return ALLOWED_PHOTO_HOSTS.some((pattern) => pattern.test(url.hostname));
  } catch {
    return false;
  }
}

export type SavedRidePhotos = {
  photos: string[];
  /** Whether the public Home/Follow feed may show them. */
  public: boolean;
  savedAt: string;
};

type Store = Record<string, SavedRidePhotos>;

async function readStore(): Promise<Store> {
  return (await getJSON<Store>(KV_KEY)) ?? {};
}

type StravaPhoto = {
  unique_id?: string;
  urls?: Record<string, string>;
  caption?: string;
};

type StravaSummaryActivity = {
  id: number;
  name: string;
  start_date_local?: string;
  start_date?: string;
  total_photo_count?: number;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = (req.query.action as string) ?? "saved";
  const signedIn = Boolean(getSessionEmail(req));

  try {
    // ---- Public read: only what has been marked public ---------------------
    if (action === "saved") {
      const store = await readStore();
      const visible = Object.entries(store).filter(([, entry]) => signedIn || entry.public);
      res.status(200).json({
        rides: Object.fromEntries(
          visible.map(([id, entry]) => [id, { photos: entry.photos, public: entry.public }]),
        ),
      });
      return;
    }

    if (!signedIn) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // ---- Which recent rides even have photos ------------------------------
    if (action === "candidates") {
      const token = await getAccessToken();
      const listRes = await fetch("https://www.strava.com/api/v3/athlete/activities?per_page=60", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!listRes.ok) {
        res.status(502).json({ error: `Strava activity list failed (${listRes.status}).` });
        return;
      }
      const activities = (await listRes.json()) as StravaSummaryActivity[];
      const store = await readStore();
      res.status(200).json({
        rides: activities
          .filter((a) => (a.total_photo_count ?? 0) > 0)
          .map((a) => ({
            id: a.id,
            name: a.name,
            date: (a.start_date_local ?? a.start_date ?? "").slice(0, 10),
            photoCount: a.total_photo_count ?? 0,
            savedCount: store[String(a.id)]?.photos.length ?? 0,
            public: store[String(a.id)]?.public ?? false,
          })),
      });
      return;
    }

    // ---- The photos on one ride -------------------------------------------
    if (action === "photos") {
      const activityId = String(req.query.activityId ?? "");
      if (!activityId) {
        res.status(400).json({ error: "Which ride?" });
        return;
      }
      const token = await getAccessToken();
      const photosRes = await fetch(
        `https://www.strava.com/api/v3/activities/${activityId}/photos?size=${PHOTO_SIZE}&photo_sources=true`,
        { headers: { Authorization: `Bearer ${token}` } },
      );

      if (photosRes.status === 401 || photosRes.status === 403) {
        // The likeliest cause by far, and not obvious from a bare 403.
        res.status(403).json({
          error:
            "Strava refused the photo request. The connected token probably lacks activity:read_all, which is needed for photos on anything not fully public - reconnect Strava with that scope.",
        });
        return;
      }
      if (!photosRes.ok) {
        res.status(502).json({ error: `Strava photo request failed (${photosRes.status}).` });
        return;
      }

      const photos = (await photosRes.json()) as StravaPhoto[];
      res.status(200).json({
        photos: photos
          .map((p) => ({
            id: p.unique_id ?? "",
            // The keyed size varies with what Strava actually holds, so take
            // the requested one when present and the largest otherwise.
            url: p.urls?.[String(PHOTO_SIZE)] ?? Object.values(p.urls ?? {}).at(-1) ?? "",
            caption: p.caption ?? "",
          }))
          .filter((p) => p.url),
      });
      return;
    }

    // ---- Keep a selection ------------------------------------------------
    if (action === "save" && req.method === "POST") {
      const body = req.body as { activityId?: string | number; urls?: string[]; public?: boolean };
      const activityId = String(body.activityId ?? "");
      const urls = (body.urls ?? []).slice(0, MAX_PHOTOS_PER_RIDE);
      if (!activityId) {
        res.status(400).json({ error: "Which ride?" });
        return;
      }

      const rejected = urls.filter((u) => !isAllowedPhotoUrl(u));
      if (rejected.length > 0) {
        res.status(400).json({ error: "Those photo URLs aren't Strava-hosted." });
        return;
      }

      const photos: string[] = [];
      for (const url of urls) {
        const imageRes = await fetch(url);
        if (!imageRes.ok) continue;
        const buffer = Buffer.from(await imageRes.arrayBuffer());
        if (buffer.byteLength > MAX_PHOTO_BYTES) continue;
        const contentType = imageRes.headers.get("content-type") ?? "image/jpeg";
        photos.push(`data:${contentType};base64,${buffer.toString("base64")}`);
      }

      const store = await readStore();
      if (photos.length === 0) {
        delete store[activityId];
      } else {
        store[activityId] = { photos, public: body.public === true, savedAt: new Date().toISOString() };
      }

      // Oldest saved rides go first once the cap is hit, so the store can't
      // grow without limit as the season goes on.
      const trimmed: Store = {};
      for (const [id, entry] of Object.entries(store)
        .sort(([, a], [, b]) => (a.savedAt < b.savedAt ? 1 : -1))
        .slice(0, MAX_RIDES)) {
        trimmed[id] = entry;
      }
      await setJSON(KV_KEY, trimmed);

      res.status(200).json({ ok: true, saved: photos.length, dropped: urls.length - photos.length });
      return;
    }

    res.status(400).json({ error: "Unknown action." });
  } catch (error) {
    console.error("strava-photos", action, error);
    res.status(500).json({ error: "Ride photo request failed." });
  }
}
