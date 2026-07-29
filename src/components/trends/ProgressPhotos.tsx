import { useEffect, useState } from "react";
import { photoToDataUrl, readImageFile } from "../../utils/resizeImage";
import { irelandTodayDateStr } from "../../utils/irelandDate";
import styles from "./ProgressPhotos.module.css";

/**
 * Progress photos: front, side and back, taken on a date, with any two dates
 * put beside each other.
 *
 * The scale reports a number and the chart reports its direction; neither
 * shows what actually changed. Comparison is the whole feature — a single
 * photo is a photo, and two from different months is the evidence — so the
 * default view is two sessions side by side rather than a gallery to scroll.
 */

const ANGLES = ["front", "side", "back"] as const;
type Angle = (typeof ANGLES)[number];

interface PhotoSession {
  date: string;
  front?: string;
  side?: string;
  back?: string;
  weightKg?: number;
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export default function ProgressPhotos({ latestWeightKg, weightUnitLabel }: { latestWeightKg?: number | null; weightUnitLabel?: string }) {
  const [sessions, setSessions] = useState<PhotoSession[] | null>(null);
  const [uploadDate, setUploadDate] = useState(() => irelandTodayDateStr());
  const [busy, setBusy] = useState<Angle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leftDate, setLeftDate] = useState<string>("");
  const [rightDate, setRightDate] = useState<string>("");

  useEffect(() => {
    fetch("/api/progress-photos")
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => setSessions(body?.sessions ?? []))
      .catch(() => setSessions([]));
  }, []);

  // Defaults to the first and last sessions — the widest comparison available,
  // which is the one worth seeing without choosing anything.
  useEffect(() => {
    if (!sessions || sessions.length === 0) return;
    setLeftDate((current) => current || sessions[0].date);
    setRightDate((current) => current || sessions[sessions.length - 1].date);
  }, [sessions]);

  async function upload(angle: Angle, file: File | undefined) {
    if (!file) return;
    setBusy(angle);
    setError(null);
    try {
      const image = await readImageFile(file);
      const dataUrl = photoToDataUrl(image);
      const response = await fetch("/api/progress-photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: uploadDate, [angle]: dataUrl, weightKg: latestWeightKg ?? undefined }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "Upload failed");
      const body = await response.json();
      setSessions(body.sessions ?? []);
      // Jump the comparison to what was just added, since that is what the
      // upload was for.
      setRightDate(uploadDate);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that photo.");
    } finally {
      setBusy(null);
    }
  }

  async function removeSession(date: string) {
    const response = await fetch(`/api/progress-photos?date=${encodeURIComponent(date)}`, { method: "DELETE" });
    if (!response.ok) return;
    const body = await response.json();
    setSessions(body.sessions ?? []);
    if (leftDate === date) setLeftDate("");
    if (rightDate === date) setRightDate("");
  }

  if (sessions === null) return <p className={styles.muted}>Loading photos…</p>;

  const byDate = new Map(sessions.map((s) => [s.date, s]));
  // Sessions are stored oldest first, so the baseline is the first of them.
  // It is kept whatever else is trimmed, and labelled so that is visible
  // rather than a rule the server applies silently.
  const baselineDate = sessions[0]?.date;
  const label = (iso: string) => (iso === baselineDate ? `${formatDate(iso)} · baseline` : formatDate(iso));
  const left = byDate.get(leftDate);
  const right = byDate.get(rightDate);
  const todaySession = byDate.get(uploadDate);

  return (
    <div className={styles.wrap}>
      <div className={styles.uploadRow}>
        <label className={styles.dateLabel}>
          Date
          <input type="date" value={uploadDate} onChange={(e) => setUploadDate(e.target.value)} className={styles.dateInput} />
        </label>
        {ANGLES.map((angle) => (
          <label key={angle} className={styles.uploadButton}>
            {busy === angle ? "…" : todaySession?.[angle] ? `Replace ${angle}` : angle}
            <input
              type="file"
              accept="image/*"
              className={styles.hiddenInput}
              onChange={(e) => {
                upload(angle, e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
        ))}
      </div>
      <p className={styles.muted}>
        Same three angles each time, same spot and same light if you can — the comparison is only worth as much as the
        framing it shares.
      </p>
      {error && <p className={styles.error}>{error}</p>}

      {sessions.length === 0 ? (
        <p className={styles.muted}>No photos yet. Add a front, side and back to start the record.</p>
      ) : (
        <>
          <div className={styles.compareControls}>
            <select value={leftDate} onChange={(e) => setLeftDate(e.target.value)} aria-label="Compare from">
              {sessions.map((s) => (
                <option key={s.date} value={s.date}>
                  {label(s.date)}
                </option>
              ))}
            </select>
            <span className={styles.muted}>vs</span>
            <select value={rightDate} onChange={(e) => setRightDate(e.target.value)} aria-label="Compare to">
              {sessions.map((s) => (
                <option key={s.date} value={s.date}>
                  {label(s.date)}
                </option>
              ))}
            </select>
            {left && right && left.date !== right.date && left.weightKg != null && right.weightKg != null && (
              <span className={styles.delta}>
                {right.weightKg - left.weightKg > 0 ? "+" : ""}
                {Math.round((right.weightKg - left.weightKg) * 10) / 10}
                {weightUnitLabel ?? "kg"} between them
              </span>
            )}
          </div>

          {/* A row per angle rather than a column per date: the point of
              comparison is the same angle beside itself, and a grid ordered
              the other way puts front next to side. */}
          {ANGLES.map((angle) => {
            const before = left?.[angle];
            const after = right?.[angle];
            if (!before && !after) return null;
            return (
              <div key={angle} className={styles.angleRow}>
                <span className={styles.angleLabel}>{angle}</span>
                <div className={styles.pair}>
                  <figure className={styles.figure}>
                    {before ? <img src={before} alt={`${angle}, ${formatDate(left!.date)}`} className={styles.photo} /> : <div className={styles.missing}>none</div>}
                    <figcaption className={styles.caption}>{left ? label(left.date) : ""}</figcaption>
                  </figure>
                  <figure className={styles.figure}>
                    {after ? <img src={after} alt={`${angle}, ${formatDate(right!.date)}`} className={styles.photo} /> : <div className={styles.missing}>none</div>}
                    <figcaption className={styles.caption}>{right ? label(right.date) : ""}</figcaption>
                  </figure>
                </div>
              </div>
            );
          })}

          <details className={styles.manage}>
            <summary className={styles.muted}>All sessions ({sessions.length})</summary>
            <p className={styles.muted}>
              The oldest is kept as your baseline and is never trimmed away — only the sessions after it are thinned
              once there are more than 24. Removing it here is deliberate and can&apos;t be undone.
            </p>
            {sessions.map((s) => (
              <div key={s.date} className={styles.manageRow}>
                <span>{label(s.date)}</span>
                <span className={styles.muted}>
                  {ANGLES.filter((a) => s[a]).join(", ") || "none"}
                  {s.weightKg != null ? ` · ${Math.round(s.weightKg * 10) / 10}kg` : ""}
                </span>
                <button type="button" onClick={() => removeSession(s.date)} className={styles.removeButton}>
                  Remove
                </button>
              </div>
            ))}
          </details>
        </>
      )}
    </div>
  );
}
