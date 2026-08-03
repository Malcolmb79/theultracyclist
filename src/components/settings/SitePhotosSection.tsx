import { useEffect, useState } from "react";
import { heroPhotoToDataUrl, photoToDataUrl, readImageFile } from "../../utils/resizeImage";
import type { SitePhotoSlot, SitePhotos } from "../../utils/useSitePhotos";
import styles from "./SitePhotosSection.module.css";

/**
 * The two photographs on the public home page.
 *
 * Each slot says where it lands and what shape suits it, because the framing
 * matters more than the file: a portrait shot behind the headline gets cropped
 * to a letterbox, and there's no way to discover that from a file picker.
 */
const SLOTS: { slot: SitePhotoSlot; title: string; hint: string; shape: string }[] = [
  {
    slot: "hero",
    title: "Hero photo",
    hint: "Fills the top of the home page behind the headline. A riding shot works best — on the time-trial bike, in the drops, on the road.",
    shape: "Landscape",
  },
  {
    slot: "story",
    title: "Story photo",
    hint: "Sits beside the story on the home page. Upright works best here.",
    shape: "Portrait",
  },
];

export default function SitePhotosSection() {
  const [photos, setPhotos] = useState<SitePhotos | null>(null);
  const [busy, setBusy] = useState<SitePhotoSlot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/site-photos")
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { photos?: SitePhotos } | null) =>
        setPhotos({ hero: body?.photos?.hero ?? null, story: body?.photos?.story ?? null }),
      )
      .catch(() => setPhotos({ hero: null, story: null }));
  }, []);

  const save = async (slot: SitePhotoSlot, dataUrl: string | null) => {
    setBusy(slot);
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/site-photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot, dataUrl }),
      });
      const body = (await res.json()) as { error?: string; photos?: SitePhotos };
      if (!res.ok) throw new Error(body.error ?? "Couldn't save that photo");
      // Trust the server's copy of both slots rather than patching one locally -
      // it is the thing that just decided what is stored.
      if (body.photos) setPhotos(body.photos);
      setDone(dataUrl ? "Saved - it's live on the home page." : "Photo removed.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that photo");
    } finally {
      setBusy(null);
    }
  };

  const onPick = async (slot: SitePhotoSlot, file: File | undefined) => {
    if (!file) return;
    setError(null);
    setDone(null);
    try {
      const img = await readImageFile(file);
      // The hero is displayed far larger than the story photo, so it keeps
      // more pixels - see resizeImage.ts.
      await save(slot, slot === "hero" ? heroPhotoToDataUrl(img) : photoToDataUrl(img));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that image");
    }
  };

  return (
    <div className={styles.wrap}>
      {SLOTS.map(({ slot, title, hint, shape }) => {
        const current = photos?.[slot] ?? null;
        return (
          <div key={slot} className={styles.slot}>
            <div className={[styles.preview, slot === "hero" ? styles.wide : styles.tall].join(" ")}>
              {current ? (
                <img className={styles.image} src={current} alt="" />
              ) : (
                <span className={styles.empty}>{shape}</span>
              )}
            </div>
            <div className={styles.detail}>
              <p className={styles.title}>{title}</p>
              <p className={styles.hint}>{hint}</p>
              <div className={styles.actions}>
                <label className={styles.uploadButton}>
                  {busy === slot ? "Saving…" : current ? "Replace" : "Choose photo"}
                  <input
                    type="file"
                    accept="image/*"
                    className={styles.hiddenInput}
                    disabled={busy !== null}
                    onChange={(e) => onPick(slot, e.target.files?.[0])}
                  />
                </label>
                {current && (
                  <button
                    type="button"
                    className={styles.removeButton}
                    onClick={() => save(slot, null)}
                    disabled={busy !== null}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {photos && !photos.hero && (
        <p className={styles.note}>
          With no hero photo the home page keeps its original gradient and island outline. That's deliberate — better a
          designed panel than a stock photo of someone who isn't you.
        </p>
      )}
      {error && <p className={styles.fail}>{error}</p>}
      {done && <p className={styles.ok}>{done}</p>}
    </div>
  );
}
