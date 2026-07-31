import { useEffect, useRef, useState } from "react";
import styles from "./CoachKnowledgeSection.module.css";

/**
 * Source material for the AI coach: plans, protocols, notes from a coach.
 *
 * Paste it, or drop in a .txt/.md file. Anything stored here is searched by the
 * coach when a question touches it, and it's told to prefer this over generic
 * advice - so it's worth being deliberate about what goes in.
 */

type Doc = { id: string; title: string; chars: number; chunkCount: number; addedAt: string };
type Hit = { title: string; text: string; score: number };

export default function CoachKnowledgeSection() {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [testQuery, setTestQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () =>
    fetch("/api/coach-knowledge")
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { documents?: Doc[] } | null) => setDocs(body?.documents ?? []))
      .catch(() => setDocs([]));

  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/coach-knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, text }),
      });
      const body = (await res.json()) as { doc?: Doc; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Couldn't save that");
      setDone(`Stored "${body.doc?.title}" in ${body.doc?.chunkCount} passages.`);
      setTitle("");
      setText("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (doc: Doc) => {
    if (!window.confirm(`Remove "${doc.title}"? The coach will stop using it.`)) return;
    await fetch(`/api/coach-knowledge?id=${encodeURIComponent(doc.id)}`, { method: "DELETE" }).catch(() => {});
    await load();
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    // Plain text only - a PDF read this way is bytes, not prose, and would
    // fill the store with rubbish that still scores on searches.
    if (!/\.(txt|md|markdown)$/i.test(file.name)) {
      setError("Text files only (.txt or .md). For a PDF, copy the text out and paste it.");
      return;
    }
    setText(await file.text());
    if (!title) setTitle(file.name.replace(/\.[^.]+$/, ""));
  };

  const runTest = async () => {
    if (!testQuery.trim()) return;
    const res = await fetch(`/api/coach-knowledge?q=${encodeURIComponent(testQuery)}`);
    const body = (await res.json()) as { hits?: Hit[] };
    setHits(body.hits ?? []);
  };

  return (
    <div className={styles.wrap}>
      {docs != null && docs.length > 0 && (
        <ul className={styles.list}>
          {docs.map((doc) => (
            <li key={doc.id} className={styles.item}>
              <span className={styles.itemMain}>
                <span className={styles.itemTitle}>{doc.title}</span>
                <span className={styles.itemMeta}>
                  {doc.chunkCount} passages · {(doc.chars / 1000).toFixed(1)}k characters
                </span>
              </span>
              <button type="button" className={styles.remove} onClick={() => remove(doc)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {docs != null && docs.length === 0 && (
        <p className={styles.hint}>Nothing stored yet — the coach falls back on general knowledge.</p>
      )}

      <input
        type="text"
        className={styles.input}
        placeholder="Title — e.g. Coach's fuelling protocol"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        className={styles.textarea}
        placeholder="Paste the material here, or choose a .txt / .md file below."
        rows={6}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      <div className={styles.actions}>
        <label className={styles.fileButton}>
          Choose file
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.md,.markdown,text/plain"
            className={styles.hiddenInput}
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </label>
        <span className={styles.count}>{text.length.toLocaleString("en-GB")} characters</span>
        <button type="button" className={styles.saveButton} onClick={save} disabled={busy || !text.trim()}>
          {busy ? "Storing…" : "Add to knowledge base"}
        </button>
      </div>

      {error && <p className={styles.fail}>{error}</p>}
      {done && <p className={styles.ok}>{done}</p>}

      {docs != null && docs.length > 0 && (
        <div className={styles.test}>
          <p className={styles.testLabel}>
            Check something is findable — this runs the same search the coach uses.
          </p>
          <div className={styles.actions}>
            <input
              type="text"
              className={styles.input}
              placeholder="e.g. carbs per hour"
              value={testQuery}
              onChange={(e) => setTestQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runTest()}
            />
            <button type="button" className={styles.saveButton} onClick={runTest}>
              Search
            </button>
          </div>
          {hits != null &&
            (hits.length === 0 ? (
              <p className={styles.hint}>No passage matched — the coach would say your plan doesn't cover it.</p>
            ) : (
              <ul className={styles.hits}>
                {hits.map((hit, i) => (
                  <li key={i} className={styles.hit}>
                    <span className={styles.hitTitle}>{hit.title}</span>
                    <span className={styles.hitText}>{hit.text.slice(0, 240)}…</span>
                  </li>
                ))}
              </ul>
            ))}
        </div>
      )}
    </div>
  );
}
