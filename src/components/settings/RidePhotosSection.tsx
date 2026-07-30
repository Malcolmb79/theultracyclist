import { useEffect, useState } from "react";
import styles from "./RidePhotosSection.module.css";

/**
 * Pick which Strava photos to keep for a ride, and whether they show publicly.
 *
 * Chosen photos are copied into the app's own storage rather than linked:
 * Strava's photo URLs are signed and expire, so a saved link would work for a
 * while and then quietly break (see api/strava-photos.ts).
 */

type Candidate = {
  id: number;
  name: string;
  date: string;
  photoCount: number;
  savedCount: number;
  public: boolean;
};

type Photo = { id: string; url: string; caption: string };

const MAX_PER_RIDE = 6;

export default function RidePhotosSection() {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [openRide, setOpenRide] = useState<Candidate | null>(null);
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [makePublic, setMakePublic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const loadCandidates = () =>
    fetch("/api/strava-photos?action=candidates")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Couldn't list rides"))))
      .then((body: { rides: Candidate[] }) => setCandidates(body.rides ?? []))
      .catch((e) => {
        setCandidates([]);
        setError(e instanceof Error ? e.message : "Couldn't list rides");
      });

  useEffect(() => {
    loadCandidates();
  }, []);

  const openPhotos = async (ride: Candidate) => {
    setError(null);
    setDone(null);
    setOpenRide(ride);
    setPhotos(null);
    setSelected([]);
    setMakePublic(ride.public);
    try {
      const res = await fetch(`/api/strava-photos?action=photos&activityId=${ride.id}`);
      const body = (await res.json()) as { photos?: Photo[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Couldn't load photos");
      setPhotos(body.photos ?? []);
    } catch (e) {
      setPhotos([]);
      setError(e instanceof Error ? e.message : "Couldn't load photos");
    }
  };

  const toggle = (url: string) =>
    setSelected((prev) =>
      prev.includes(url) ? prev.filter((u) => u !== url) : prev.length >= MAX_PER_RIDE ? prev : [...prev, url],
    );

  const save = async () => {
    if (!openRide) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/strava-photos?action=save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activityId: openRide.id, urls: selected, public: makePublic }),
      });
      const body = (await res.json()) as { saved?: number; dropped?: number; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Couldn't save");
      setDone(
        selected.length === 0
          ? "Cleared this ride's photos."
          : `Saved ${body.saved} photo${body.saved === 1 ? "" : "s"}${body.dropped ? `, skipped ${body.dropped}` : ""}.`,
      );
      await loadCandidates();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  };

  if (candidates == null) return <p className={styles.hint}>Looking for rides with photos…</p>;

  return (
    <div className={styles.wrap}>
      {candidates.length === 0 ? (
        <p className={styles.hint}>
          No recent ride reports a photo on Strava{error ? ` (${error})` : ""}.
        </p>
      ) : (
        <ul className={styles.rides}>
          {candidates.map((ride) => (
            <li key={ride.id} className={styles.ride}>
              <button
                type="button"
                className={`${styles.rideButton} ${openRide?.id === ride.id ? styles.rideButtonOpen : ""}`}
                onClick={() => (openRide?.id === ride.id ? setOpenRide(null) : openPhotos(ride))}
              >
                <span className={styles.rideName}>{ride.name}</span>
                <span className={styles.rideMeta}>
                  {ride.date} · {ride.photoCount} on Strava
                  {ride.savedCount > 0 && ` · ${ride.savedCount} kept${ride.public ? ", public" : ""}`}
                </span>
              </button>

              {openRide?.id === ride.id && (
                <div className={styles.picker}>
                  {photos == null ? (
                    <p className={styles.hint}>Loading photos…</p>
                  ) : photos.length === 0 ? (
                    <p className={styles.hint}>Strava returned no photos for this ride.</p>
                  ) : (
                    <>
                      <div className={styles.grid}>
                        {photos.map((photo) => {
                          const isOn = selected.includes(photo.url);
                          return (
                            <button
                              key={photo.id || photo.url}
                              type="button"
                              className={`${styles.thumb} ${isOn ? styles.thumbOn : ""}`}
                              onClick={() => toggle(photo.url)}
                              aria-pressed={isOn}
                              title={photo.caption || "Ride photo"}
                            >
                              <img src={photo.url} alt={photo.caption || ""} loading="lazy" />
                              {isOn && <span className={styles.tick}>✓</span>}
                            </button>
                          );
                        })}
                      </div>

                      <label className={styles.publicRow}>
                        <input type="checkbox" checked={makePublic} onChange={(e) => setMakePublic(e.target.checked)} />
                        Show these on the public ride feed
                      </label>

                      <div className={styles.actions}>
                        <span className={styles.count}>
                          {selected.length}/{MAX_PER_RIDE} selected
                        </span>
                        <button type="button" className={styles.saveButton} onClick={save} disabled={busy}>
                          {busy ? "Saving…" : selected.length === 0 ? "Clear saved photos" : "Save selection"}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && <p className={styles.fail}>{error}</p>}
      {done && <p className={styles.ok}>{done}</p>}
    </div>
  );
}
