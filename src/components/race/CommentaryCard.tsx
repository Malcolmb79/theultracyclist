import { useEffect, useRef, useState, type RefObject } from "react";
import { useStoredState } from "../../utils/useStoredState";
import type { RaceRecorder } from "./raceLog";
import {
  COMMENTARY_EVERY_MS,
  COMMENTARY_MIN_GAP_MS,
  buildSnapshot,
  isNewsworthy,
  isSpeaking,
  requestCommentary,
  speak,
  stopSpeaking,
} from "./commentary";
import styles from "./RaceConsole.module.css";

const SHOWN_LINES = 6;
/** Waiting on the voice to finish is polite, up to a point. */
const MAX_WAIT_FOR_VOICE_MS = 15_000;

interface Props {
  recorder: RefObject<RaceRecorder | null>;
  recording: boolean;
  /** "" for the site (same origin); the site's URL for the mod. */
  apiBase: string;
  /** The mod can't use the site's session and needs a key pasted in. */
  needsKey: boolean;
  /** Called after a line lands in the log, so the race log can refresh. */
  onLine: () => void;
}

export default function CommentaryCard({ recorder, recording, apiBase, needsKey, onLine }: Props) {
  const [enabled, setEnabled] = useStoredState("race:commentary-on", true, (v) => (typeof v === "boolean" ? v : null));
  const [voice, setVoice] = useStoredState("race:commentary-voice", true, (v) => (typeof v === "boolean" ? v : null));
  const [key, setKey] = useStoredState<string | null>("race:commentary-key", null, (v) =>
    typeof v === "string" && v ? v : null,
  );
  const [keyDraft, setKeyDraft] = useState("");
  const [lines, setLines] = useState<{ at: number; text: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Read inside the timer, which is set up once per recording.
  const live = useRef({ enabled, voice, key, onLine });
  live.current = { enabled, voice, key, onLine };

  const canRun = recording && enabled && (!needsKey || !!key);

  useEffect(() => {
    if (!canRun) return;
    let inFlight = false;
    let lastAt = 0;
    let lastT = -1;
    const timer = setInterval(async () => {
      const r = recorder.current;
      if (!r || inFlight || r.log.samples.length === 0) return;
      const now = Date.now();
      const since = now - lastAt;
      const news = r.log.events.some((e) => e.t > lastT && isNewsworthy(e));
      const due = since >= COMMENTARY_EVERY_MS || (news && since >= COMMENTARY_MIN_GAP_MS);
      if (!due) return;
      if (live.current.voice && isSpeaking() && since < MAX_WAIT_FOR_VOICE_MS) return;

      inFlight = true;
      setBusy(true);
      lastAt = now;
      const snapshotT = now - Date.parse(r.log.startedAt);
      try {
        const text = await requestCommentary(apiBase, needsKey ? live.current.key : null, buildSnapshot(r.log, lastT));
        lastT = snapshotT;
        setError(null);
        // The recording may have been stopped while the line was in flight.
        if (text && recorder.current === r && live.current.enabled) {
          r.commentary(text);
          setLines((prev) => [{ at: snapshotT, text }, ...prev].slice(0, SHOWN_LINES));
          if (live.current.voice) speak(text);
          live.current.onLine();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Commentary failed.");
      } finally {
        inFlight = false;
        setBusy(false);
      }
    }, 1000);
    return () => {
      clearInterval(timer);
      stopSpeaking();
    };
  }, [canRun, apiBase, needsKey, recorder]);

  const [latest, ...earlier] = lines;

  return (
    <section className={styles.card}>
      <div className={styles.commentaryHeader}>
        <h2 className={styles.cardTitle}>Live commentary</h2>
        <div className={styles.commentaryControls}>
          {busy && <span className={styles.commentaryBusy}>On air…</span>}
          <label className={styles.toggle}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Commentary
          </label>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={voice}
              onChange={(e) => {
                setVoice(e.target.checked);
                if (!e.target.checked) stopSpeaking();
              }}
            />
            Voice
          </label>
        </div>
      </div>

      {needsKey && !key ? (
        <form
          className={styles.keyForm}
          onSubmit={(e) => {
            e.preventDefault();
            if (keyDraft.trim()) setKey(keyDraft.trim());
          }}
        >
          <p className={styles.empty}>
            Commentary needs a key from your site: open theultracyclist.com/dashboard/race, click{" "}
            <strong>Copy key for the Sauce mod</strong>, and paste it here.
          </p>
          <div className={styles.addressForm}>
            <input
              className={styles.keyInput}
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder="Paste key"
              aria-label="Commentary key"
              spellCheck={false}
            />
            <button type="submit" className={styles.secondaryButton} disabled={!keyDraft.trim()}>
              Save
            </button>
          </div>
        </form>
      ) : !recording ? (
        <p className={styles.empty}>Start recording and the commentary begins with the race.</p>
      ) : !enabled ? (
        <p className={styles.empty}>Commentary is off.</p>
      ) : !latest ? (
        <p className={styles.empty}>Warming up the commentary box…</p>
      ) : (
        <>
          <p className={styles.commentaryLatest}>{latest.text}</p>
          {earlier.length > 0 && (
            <ol className={styles.commentaryEarlier}>
              {earlier.map((l) => (
                <li key={l.at}>{l.text}</li>
              ))}
            </ol>
          )}
        </>
      )}

      {error && (
        <p className={styles.commentaryError}>
          {error}
          {needsKey && key && /key/.test(error) && (
            <>
              {" "}
              <button type="button" className={styles.linkButton} onClick={() => setKey(null)}>
                Enter a new key
              </button>
            </>
          )}
        </p>
      )}

      {!needsKey && <ModKeyButton />}
    </section>
  );
}

/** On the site: hands over a key for the Sauce mod to use. */
function ModKeyButton() {
  const [state, setState] = useState<"idle" | "working" | "copied" | "error">("idle");
  const [token, setToken] = useState<string | null>(null);

  const issue = async () => {
    setState("working");
    try {
      const res = await fetch("/api/race-token", { method: "POST" });
      if (!res.ok) throw new Error();
      const body = (await res.json()) as { token: string };
      setToken(body.token);
      try {
        await navigator.clipboard.writeText(body.token);
        setState("copied");
      } catch {
        // No clipboard access - the key is shown to copy by hand instead.
        setState("idle");
      }
    } catch {
      setState("error");
    }
  };

  return (
    <div className={styles.modKey}>
      <button type="button" className={styles.secondaryButton} onClick={issue} disabled={state === "working"}>
        Copy key for the Sauce mod
      </button>
      <span className={styles.savedMeta}>
        {state === "copied"
          ? "Copied - paste it into the mod's commentary box. It lasts 90 days."
          : state === "error"
            ? "Couldn't create a key - try signing in again."
            : "Only needed when running commentary from the Sauce mod."}
      </span>
      {token && state !== "copied" && <code className={styles.keyText}>{token}</code>}
    </div>
  );
}
