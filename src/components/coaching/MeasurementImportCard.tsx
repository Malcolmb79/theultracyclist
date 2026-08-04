import { useCallback, useEffect, useState } from "react";
import { heroPhotoToDataUrl, readImageFile } from "../../utils/resizeImage";
import styles from "./MeasurementImportCard.module.css";

/**
 * Screenshot in, measurements out, nothing saved until it has been read.
 *
 * The review table is the feature, not a formality. A vision model reading
 * digits off a phone screenshot gets almost all of them right, and the ones
 * it gets wrong look exactly like the ones it gets right. Since these rows
 * are meant to feed widgets and the coach, an unreviewed import would put
 * numbers nobody has ever checked underneath advice about training.
 *
 * Rows the model was unsure of arrive unticked, so the default action leaves
 * them out rather than including them.
 */

type Row = {
  metric: string;
  label: string;
  value: number;
  unit: string | null;
  measuredOn: string | null;
  confidence: "high" | "low";
  include: boolean;
};

type Stored = {
  id: number;
  measuredOn: string;
  metric: string;
  label: string;
  value: number;
  unit: string | null;
  source: string;
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function MeasurementImportCard() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [source, setSource] = useState("");
  const [fallbackDate, setFallbackDate] = useState(today());
  const [busy, setBusy] = useState<"reading" | "saving" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [recent, setRecent] = useState<Stored[]>([]);

  const loadRecent = useCallback(() => {
    fetch("/api/measurements?limit=12")
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { measurements?: Stored[] } | null) => setRecent(b?.measurements ?? []))
      .catch(() => {});
  }, []);

  useEffect(loadRecent, [loadRecent]);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setDone(null);
    setBusy("reading");
    try {
      // Resized before it leaves the browser: a phone screenshot is several
      // megabytes and every one of them would otherwise be uploaded whole.
      const img = await readImageFile(file);
      const dataUrl = heroPhotoToDataUrl(img);
      const res = await fetch("/api/measurements-extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: dataUrl.split(",")[1], mediaType: "image/jpeg" }),
      });
      const body = (await res.json()) as { error?: string; source?: string; measurements?: Omit<Row, "include">[] };
      if (!res.ok) throw new Error(body.error ?? "Could not read that screenshot");

      const found = body.measurements ?? [];
      if (found.length === 0) {
        setRows([]);
        setError("No measurements found in that screenshot.");
      } else {
        setRows(found.map((r) => ({ ...r, include: r.confidence === "high" })));
        if (body.source) setSource(body.source);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that screenshot");
    } finally {
      setBusy(null);
    }
  };

  const update = (i: number, patch: Partial<Row>) =>
    setRows((current) => current?.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) ?? current);

  const save = async () => {
    if (!rows) return;
    const chosen = rows.filter((r) => r.include);
    if (chosen.length === 0) {
      setError("Nothing ticked to import.");
      return;
    }
    if (!source.trim()) {
      setError("Say which app this came from - it is part of how a row is identified.");
      return;
    }
    setBusy("saving");
    setError(null);
    try {
      const res = await fetch("/api/measurements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          measurements: chosen.map((r) => ({
            measuredOn: r.measuredOn ?? fallbackDate,
            metric: r.metric,
            label: r.label,
            value: r.value,
            unit: r.unit,
            source: source.trim(),
          })),
        }),
      });
      const body = (await res.json()) as { error?: string; inserted?: number; updated?: number };
      if (!res.ok) throw new Error(body.error ?? "Could not save those measurements");
      const parts = [
        body.inserted ? `${body.inserted} added` : null,
        body.updated ? `${body.updated} updated` : null,
      ].filter(Boolean);
      setDone(parts.length ? parts.join(", ") + "." : "Nothing changed.");
      setRows(null);
      loadRecent();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save those measurements");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: number) => {
    await fetch(`/api/measurements?id=${id}`, { method: "DELETE" }).catch(() => {});
    loadRecent();
  };

  const undated = rows?.some((r) => r.include && !r.measuredOn) ?? false;

  return (
    <div className={styles.wrap}>
      {!rows && (
        <>
          <p className={styles.intro}>
            Screenshot anything that isn&apos;t wired in - a scale, a sleep app, blood results - and it gets read into
            the measurements table. Nothing is saved until you approve it.
          </p>
          <label className={styles.uploadButton}>
            {busy === "reading" ? "Reading…" : "Choose screenshot"}
            <input
              type="file"
              accept="image/*"
              className={styles.hiddenInput}
              disabled={busy !== null}
              onChange={(e) => onPick(e.target.files?.[0])}
            />
          </label>
        </>
      )}

      {rows && rows.length > 0 && (
        <>
          <div className={styles.reviewHead}>
            <p className={styles.reviewTitle}>Found {rows.length}. Check before importing.</p>
            <button type="button" className={styles.linkButton} onClick={() => setRows(null)}>
              Discard
            </button>
          </div>

          <div className={styles.fields}>
            <label className={styles.field}>
              <span>App</span>
              <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Oura, InBody…" />
            </label>
            {undated && (
              <label className={styles.field}>
                <span>Date for undated rows</span>
                <input type="date" value={fallbackDate} onChange={(e) => setFallbackDate(e.target.value)} />
              </label>
            )}
          </div>

          <ul className={styles.rows}>
            {rows.map((r, i) => (
              <li key={i} className={r.include ? styles.row : `${styles.row} ${styles.rowOff}`}>
                <input
                  type="checkbox"
                  checked={r.include}
                  onChange={(e) => update(i, { include: e.target.checked })}
                  aria-label={`Import ${r.label}`}
                />
                <div className={styles.rowBody}>
                  <input
                    className={styles.labelInput}
                    value={r.label}
                    onChange={(e) => update(i, { label: e.target.value })}
                  />
                  <div className={styles.rowValues}>
                    <input
                      className={styles.valueInput}
                      type="number"
                      step="any"
                      value={r.value}
                      onChange={(e) => update(i, { value: Number(e.target.value) })}
                    />
                    <input
                      className={styles.unitInput}
                      value={r.unit ?? ""}
                      placeholder="unit"
                      onChange={(e) => update(i, { unit: e.target.value || null })}
                    />
                    <input
                      className={styles.dateInput}
                      type="date"
                      value={r.measuredOn ?? ""}
                      onChange={(e) => update(i, { measuredOn: e.target.value || null })}
                    />
                  </div>
                  {r.confidence === "low" && (
                    <span className={styles.lowFlag}>Unsure of this one - check it against the screenshot</span>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <button type="button" className={styles.saveButton} onClick={save} disabled={busy !== null}>
            {busy === "saving" ? "Importing…" : `Import ${rows.filter((r) => r.include).length}`}
          </button>
        </>
      )}

      {error && <p className={styles.fail}>{error}</p>}
      {done && <p className={styles.ok}>{done}</p>}

      {recent.length > 0 && (
        <div className={styles.recent}>
          <p className={styles.recentTitle}>Stored</p>
          <ul className={styles.recentList}>
            {recent.map((m) => (
              <li key={m.id}>
                <span className={styles.recentDate}>{m.measuredOn}</span>
                <span className={styles.recentLabel}>{m.label}</span>
                <span className={styles.recentValue}>
                  {m.value}
                  {m.unit ? ` ${m.unit}` : ""}
                </span>
                <button type="button" className={styles.removeButton} onClick={() => remove(m.id)} aria-label="Delete">
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
