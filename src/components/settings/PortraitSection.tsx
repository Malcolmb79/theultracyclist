import { useEffect, useState } from "react";
import { photoToDataUrl, readImageFile } from "../../utils/resizeImage";
import { about } from "../../data/about";
import styles from "./PortraitSection.module.css";

/**
 * The portrait on the public About section.
 *
 * Deliberately blunt in its wording: unlike the profile picture above it (which
 * only appears in the athlete's own menu), whatever is chosen here is published
 * on the public site.
 */
export default function PortraitSection() {
  const [portrait, setPortrait] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/site-portrait")
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { portraitDataUrl?: string | null } | null) => setPortrait(body?.portraitDataUrl ?? null))
      .catch(() => setPortrait(null));
  }, []);

  const save = async (dataUrl: string | null) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/site-portrait", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Couldn't save that photo");
      setPortrait(dataUrl);
      setDone(dataUrl ? "Portrait updated - it's live on the About page." : "Portrait removed.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that photo");
    } finally {
      setBusy(false);
    }
  };

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setDone(null);
    try {
      // Resized in the browser before it ever leaves - a phone photo is several
      // megabytes and the public page reads this record on every visit.
      const img = await readImageFile(file);
      await save(photoToDataUrl(img));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that image");
    }
  };

  const shown = portrait ?? about.portraitImage;

  return (
    <div className={styles.wrap}>
      <div className={styles.row}>
        <img className={styles.preview} src={shown} alt="" />
        <div className={styles.actions}>
          <label className={styles.uploadButton}>
            {busy ? "Saving…" : portrait ? "Replace photo" : "Choose photo"}
            <input
              type="file"
              accept="image/*"
              className={styles.hiddenInput}
              disabled={busy}
              onChange={(e) => onPick(e.target.files?.[0])}
            />
          </label>
          {portrait && (
            <button type="button" className={styles.removeButton} onClick={() => save(null)} disabled={busy}>
              Remove
            </button>
          )}
          <p className={styles.note}>
            {portrait
              ? "Live on the public About page."
              : portrait === null
                ? "Currently showing the placeholder illustration."
                : "Loading…"}
          </p>
        </div>
      </div>

      {error && <p className={styles.fail}>{error}</p>}
      {done && <p className={styles.ok}>{done}</p>}
    </div>
  );
}
