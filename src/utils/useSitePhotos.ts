import { useEffect, useState } from "react";

export type SitePhotoSlot = "hero" | "story";
export type SitePhotos = Record<SitePhotoSlot, string | null>;

const EMPTY: SitePhotos = { hero: null, story: null };

/**
 * The home page's photographs, uploaded in Settings.
 *
 * Returns nulls until they arrive, and stays on nulls if nothing has been
 * uploaded or the request fails. Every consumer has to render something
 * respectable without a photo anyway - the site went live before there were
 * any - so a failure here is the same case as an empty slot rather than an
 * error worth reporting to a visitor.
 */
export function useSitePhotos(): SitePhotos {
  const [photos, setPhotos] = useState<SitePhotos>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/site-photos")
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { photos?: Partial<SitePhotos> } | null) => {
        if (cancelled || !body?.photos) return;
        setPhotos({ hero: body.photos.hero ?? null, story: body.photos.story ?? null });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return photos;
}
