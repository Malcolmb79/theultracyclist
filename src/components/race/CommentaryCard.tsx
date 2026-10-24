import { useEffect, useRef, useState, type RefObject } from "react";
import { useStoredState } from "../../utils/useStoredState";
import type { RaceRecorder } from "./raceLog";
import {
  COMMENTARY_EVERY_MS,
  COMMENTARY_MIN_GAP_MS,
  buildSnapshot,
  NATURAL_VOICES,
  VoiceUnavailableError,
  englishVoices,
  onlyBasicVoices,
  isNewsworthy,
  isSpeaking,
  requestCommentary,
  speak,
  speakNatural,
  stopSpeaking,
} from "./commentary";
import styles from "./RaceConsole.module.css";

const SHOWN_LINES = 6;
/** Waiting on the voice to finish is polite, up to a point. */
const MAX_WAIT_FOR_VOICE_MS = 15_000;
const TEST_LINE = "And they're off! Let's see who's got the legs today.";

type Engine = "natural" | "browser";

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
  const [voiceName, setVoiceName] = useStoredState<string | null>("race:commentary-voice-name", null, (v) =>
    typeof v === "string" ? v : null,
  );
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => englishVoices());
  const [engine, setEngine] = useStoredState<Engine>("race:commentary-engine", "natural", (v) =>
    v === "natural" || v === "browser" ? v : null,
  );
  const [naturalVoice, setNaturalVoice] = useStoredState("race:commentary-natural-voice", NATURAL_VOICES[0], (v) =>
    typeof v === "string" && NATURAL_VOICES.includes(v) ? v : null,
  );
  // Why the last line fell back to the browser's voice, if it did.
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [lines, setLines] = useState<{ at: number; text: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Speaks a line in the chosen voice, falling back to the browser's own. */
  const say = async (text: string) => {
    if (engine === "browser") {
      speak(text, voiceName);
      return;
    }
    try {
      await speakNatural(apiBase, needsKey ? key : null, text, naturalVoice);
      setVoiceNote(null);
    } catch (e) {
      setVoiceNote(
        e instanceof VoiceUnavailableError && e.notConfigured
          ? "The natural voice isn't set up yet: add OPENAI_API_KEY to the site's Vercel settings. Using the browser voice meanwhile."
          : `${e instanceof Error ? e.message : "Natural voice failed."} Using the browser voice for now.`,
      );
      speak(text, voiceName);
    }
  };

  // Read inside the timer, which is set up once per recording.
  const live = useRef({ enabled, voice, key, onLine, say });
  live.current = { enabled, voice, key, onLine, say };

  // Voices load after the page does, and Edge's online ones can arrive late.
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const update = () => setVoices(englishVoices());
    update();
    synth.addEventListener("voiceschanged", update);
    return () => synth.removeEventListener("voiceschanged", update);
  }, []);

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
          if (live.current.voice) void live.current.say(text);
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

      {voice && (
        <div className={styles.voiceRow}>
          <select
            className={styles.voiceSelect}
            value={engine}
            onChange={(e) => setEngine(e.target.value as Engine)}
            aria-label="Voice type"
          >
            <option value="natural">Natural voice (OpenAI)</option>
            <option value="browser">Browser voice</option>
          </select>
          {engine === "natural" ? (
            <select
              className={styles.voiceSelect}
              value={naturalVoice}
              onChange={(e) => setNaturalVoice(e.target.value)}
              aria-label="Commentary voice"
            >
              {NATURAL_VOICES.map((v) => (
                <option key={v} value={v}>
                  {v[0].toUpperCase() + v.slice(1)}
                </option>
              ))}
            </select>
          ) : (
            voices.length > 0 && (
              <select
                className={styles.voiceSelect}
                value={voices.some((v) => v.name === voiceName) ? (voiceName ?? "") : voices[0].name}
                onChange={(e) => setVoiceName(e.target.value)}
                aria-label="Commentary voice"
              >
                {voices.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name}
                  </option>
                ))}
              </select>
            )
          )}
          <button type="button" className={styles.secondaryButton} onClick={() => void say(TEST_LINE)}>
            Test voice
          </button>
          {engine === "browser" && onlyBasicVoices(voices) && (
            <span className={styles.savedMeta}>
              These are the basic Windows voices. The natural voice sounds far more human.
            </span>
          )}
          {voiceNote && <span className={styles.voiceNote}>{voiceNote}</span>}
        </div>
      )}

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
