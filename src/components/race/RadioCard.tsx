import { useEffect, useRef, useState, type RefObject } from "react";
import { SESSION_OPTIONS, useSession, type SessionChoice } from "./useSession";
import { useStoredState } from "../../utils/useStoredState";
import type { RaceRecorder } from "./raceLog";
import {
  DEFAULT_NATURAL_VOICE,
  DEFAULT_CO_VOICE,
  fetchNaturalAudio,
  playAudioUrl,
  waitQuiet,
  parseTurns,
  LINE_KIND,
  NATURAL_VOICES,
  COMMENTARY_PACE,
  PHASE_TIMING,
  interestSince,
  racePhase,
  RADIO_TIMING,
  nextSilenceMs,
  MOMENT_COOLDOWN_MS,
  TACTICS_FINALE_GAP_MS,
  fetchRiderFitness,
  keyMoments,
  sessionKind,
  fetchRiderHistory,
  ridersToLookUp,
  buildSnapshot,
  VoiceUnavailableError,
  englishVoices,
  onlyBasicVoices,
  isSpeaking,
  requestCommentary,
  speak,
  speakNatural,
  stopSpeaking,
  type CommentaryPace,
  type NameStyle,
  type RiderFitness,
  type RadioMode,
} from "./commentary";
import styles from "./RaceConsole.module.css";

const SHOWN_LINES = 6;
const FITNESS_REFRESH_MS = 30 * 60_000;
/** Riders looked up on ZwiftPower per round, and how often a round runs. */
const HISTORY_BATCH = 6;
const HISTORY_EVERY_MS = 20_000;
/** Waiting on the voice to finish is polite, up to a point. */
const MAX_WAIT_FOR_VOICE_MS = 15_000;
/** A two-commentator test: the lead, then the ex-pro answering. */
const DUO_TEST_LINE =
  "A: And they're off - and there's an attack straight away, nearly seven watts per kilo!\nB: Bold. Twenty-odd riders in that bunch though, and they'll have the draft.\nA: You don't fancy it?\nB: Not into this headwind. Ask me again at the sprint.";
const TEST_LINE: Record<RadioMode, string> = {
  commentary: "And they're off! Let's see who's got the legs today.",
  tactics: "Good start. Sit in, stay sheltered, and save it for the finish.",
};

type Engine = "natural" | "browser";

interface Props {
  mode: RadioMode;
  /** The tactics overlay: the latest call, big, and the settings tucked away. */
  compact?: boolean;
  /** Set by an overlay that opens the settings itself (from its right-click menu). */
  showSettings?: boolean;
  recorder: RefObject<RaceRecorder | null>;
  recording: boolean;
  /** "" for the site (same origin); the site's URL for the mod. */
  apiBase: string;
  /** The mod can't use the site's session and needs a key pasted in. */
  needsKey: boolean;
  /** Called after a line lands in the log, so the race log can refresh. */
  onLine?: () => void;
  /** Whether the rider being followed is the one at this computer. */
  ridingSelf: boolean;
  /**
   * Set by an overlay that switches the radio and its voice from its own
   * right-click menu; the card then shows no On / Voice switches of its own.
   */
  on?: boolean;
  voiceOn?: boolean;
}

const TITLE: Record<RadioMode, string> = { commentary: "Live commentary", tactics: "Tactics coach" };

/**
 * One race radio: live commentary about the rider, or tactical calls to
 * them. The two run side by side, each with its own voice and settings, and
 * take turns speaking (see the voice notes in ./commentary).
 */
export default function RadioCard({
  mode,
  compact = false,
  recorder,
  recording,
  apiBase,
  needsKey,
  onLine,
  ridingSelf,
  showSettings,
  on,
  voiceOn,
}: Props) {
  const [storedEnabled, setEnabled] = useStoredState(`race:${mode}-on`, true, (v) => (typeof v === "boolean" ? v : null));
  const [storedVoice, setVoice] = useStoredState(`race:${mode}-voice`, true, (v) => (typeof v === "boolean" ? v : null));
  const enabled = on ?? storedEnabled;
  const voice = voiceOn ?? storedVoice;
  const switchesOutside = on != null;
  const [session, setSession] = useSession();
  const [ownSettingsOpen, setSettingsOpen] = useState(!compact);
  const settingsOpen = showSettings ?? ownSettingsOpen;
  const [nameStyle, setNameStyle] = useStoredState<NameStyle>(`race:${mode}-names`, "surname", (v) =>
    v === "surname" || v === "first" || v === "full" ? v : null,
  );
  const [pace, setPace] = useStoredState<CommentaryPace>("race:commentary-pace", "relaxed", (v) =>
    typeof v === "string" && v in COMMENTARY_PACE ? (v as CommentaryPace) : null,
  );
  const [key, setKey] = useStoredState<string | null>("race:commentary-key", null, (v) =>
    typeof v === "string" && v ? v : null,
  );
  const [voiceName, setVoiceName] = useStoredState<string | null>(`race:${mode}-voice-name`, null, (v) =>
    typeof v === "string" ? v : null,
  );
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => englishVoices());
  const [engine, setEngine] = useStoredState<Engine>(`race:${mode}-engine`, "natural", (v) =>
    v === "natural" || v === "browser" ? v : null,
  );
  const [naturalVoice, setNaturalVoice] = useStoredState(`race:${mode}-natural-voice`, DEFAULT_NATURAL_VOICE[mode], (v) =>
    typeof v === "string" && NATURAL_VOICES.includes(v) ? v : null,
  );
  // Two in the booth (commentary only): the lead and an ex-pro co-commentator, each in their own voice.
  const [storedDuo, setDuo] = useStoredState("race:commentary-duo", false, (v) => (typeof v === "boolean" ? v : null));
  const duo = mode === "commentary" && storedDuo;
  const [coVoice, setCoVoice] = useStoredState("race:commentary-co-voice", DEFAULT_CO_VOICE, (v) =>
    typeof v === "string" && NATURAL_VOICES.includes(v) ? v : null,
  );
  const [coVoiceName, setCoVoiceName] = useStoredState<string | null>("race:commentary-co-voice-name", null, (v) =>
    typeof v === "string" ? v : null,
  );
  // Mid-exchange: the pair's turns are still being voiced, so no new line yet.
  const exchanging = useRef(false);
  // Why the last line fell back to the browser's voice, if it did.
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [lines, setLines] = useState<{ at: number; text: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fitness, setFitness] = useState<RiderFitness | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  /** Speaks a line in the chosen voice, falling back to the browser's own. */
  const sayOne = async (text: string, co = false) => {
    if (engine === "browser") {
      speak(text, co ? (coVoiceName ?? englishVoices()[1]?.name ?? voiceName) : voiceName, mode);
      return;
    }
    try {
      await speakNatural(apiBase, needsKey ? key : null, text, co ? coVoice : naturalVoice, mode, co ? "co" : undefined);
      setVoiceNote(null);
    } catch (e) {
      setVoiceNote(
        e instanceof VoiceUnavailableError && e.notConfigured
          ? "The natural voice isn't set up yet: add OPENAI_API_KEY to the site's Vercel settings. Using the browser voice meanwhile."
          : `${e instanceof Error ? e.message : "Natural voice failed."} Using the browser voice for now.`,
      );
      speak(text, voiceName, mode);
    }
  };

  /**
   * Two commentators: each turn in its speaker's voice, one after the other.
   * With the natural voices every turn is voiced up front, so the second
   * comes straight in when the first finishes.
   */
  const sayExchange = async (text: string) => {
    const turns = parseTurns(text);
    exchanging.current = true;
    try {
      let failure: unknown = null;
      const audio =
        engine === "natural"
          ? turns.map((t) =>
              fetchNaturalAudio(apiBase, needsKey ? key : null, t.text, t.speaker === "B" ? coVoice : naturalVoice, mode, t.speaker === "B" ? "co" : "lead").catch(
                (e: unknown) => {
                  failure = e;
                  return null;
                },
              ),
            )
          : [];
      const browserVoice = (co: boolean) => (co ? (coVoiceName ?? englishVoices()[1]?.name ?? voiceName) : voiceName);
      for (const [i, t] of turns.entries()) {
        const url = engine === "natural" ? await audio[i] : null;
        if (url) {
          try {
            await playAudioUrl(url, mode);
            setVoiceNote(null);
          } catch (e) {
            setVoiceNote(e instanceof Error ? e.message : "Natural voice failed.");
            speak(t.text, browserVoice(t.speaker === "B"), mode);
          }
        } else {
          // The browser's voices, when chosen or when the natural voice couldn't be had.
          if (failure) {
            setVoiceNote(
              failure instanceof VoiceUnavailableError && failure.notConfigured
                ? "The natural voice isn't set up yet: add OPENAI_API_KEY to the site's Vercel settings. Using the browser voice meanwhile."
                : `${failure instanceof Error ? failure.message : "Natural voice failed."} Using the browser voice for now.`,
            );
          }
          speak(t.text, browserVoice(t.speaker === "B"), mode);
        }
        await waitQuiet(mode);
      }
    } finally {
      exchanging.current = false;
    }
  };

  const say = (text: string) => (duo ? sayExchange(text) : sayOne(text));

  // Read inside the timer, which is set up once per recording.
  useEffect(() => {
    if (!voice) stopSpeaking(mode);
  }, [voice, mode]);

  const live = useRef({ enabled, voice, key, onLine, say, nameStyle, fitness, ridingSelf, session, duo });
  live.current = { enabled, voice, key, onLine, say, nameStyle, fitness, ridingSelf, session, duo };

  // The athlete's own fitness, read when the radio starts and every half
  // hour - it changes day to day, not lap to lap. Not having it costs
  // nothing but the extra context.
  useEffect(() => {
    if (needsKey && !key) return;
    let cancelled = false;
    const load = () =>
      fetchRiderFitness(apiBase, needsKey ? key : null)
        .then((f) => !cancelled && setFitness(f))
        .catch(() => {});
    void load();
    const timer = setInterval(load, FITNESS_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [apiBase, needsKey, key]);

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

  // The riders around, looked up on ZwiftPower a few at a time for their
  // recent racing. Shared through the recorder, so with both radios running
  // each rider is still asked about once.
  useEffect(() => {
    if (!canRun) return;
    const timer = setInterval(() => {
      const r = recorder.current;
      if (!r || r.historyOff) return;
      const ids = ridersToLookUp(r.log).filter((id) => !r.historyAsked.has(id)).slice(0, HISTORY_BATCH);
      if (!ids.length) return;
      for (const id of ids) r.historyAsked.add(id);
      fetchRiderHistory(apiBase, needsKey ? live.current.key : null, ids)
        .then(({ configured, riders }) => {
          if (!configured) r.historyOff = true;
          r.log.riderHistory = { ...r.log.riderHistory, ...riders };
        })
        // Asked again on a later round.
        .catch(() => ids.forEach((id) => r.historyAsked.delete(id)));
    }, HISTORY_EVERY_MS);
    return () => clearInterval(timer);
  }, [canRun, apiBase, needsKey, recorder]);

  useEffect(() => {
    if (!canRun) return;
    let inFlight = false;
    let lastAt = 0;
    let lastT = -1;
    // When each key moment was last called, so it isn't called again and again.
    const called = new Map<string, number>();
    const { everyMs, minGapMs } = mode === "commentary" ? COMMENTARY_PACE[pace] : RADIO_TIMING[mode];
    const threshold = mode === "commentary" ? COMMENTARY_PACE[pace].threshold : 1;
    let silence = 0; // The first line comes straight away.
    setLines([]);
    const timer = setInterval(async () => {
      const r = recorder.current;
      if (!r || inFlight || r.log.samples.length === 0) return;
      // Race or ride, as chosen - it decides what counts as a moment and the tone.
      r.log.sessionType = sessionKind(r.log, live.current.session);
      const now = Date.now();
      const since = now - lastAt;
      // Key moments not just called: what the coach calls, and for the
      // commentator what's happening on the road (race-log events, which the
      // commentator weighs separately, are left out of its list).
      const moments = keyMoments(r.log, mode === "tactics" ? lastT : Infinity).filter((m) => {
        const at = called.get(m.id);
        return at == null || (!m.id.includes("@") && now - at >= MOMENT_COOLDOWN_MS);
      });
      let due: boolean;
      if (mode === "tactics") {
        // Decision points only, and room between them - closer together in the finale.
        due = moments.length > 0 && since >= (racePhase(r.log) === "finale" ? TACTICS_FINALE_GAP_MS : minGapMs);
      } else {
        // The commentator speaks when enough has happened to be worth a line.
        const phased = PHASE_TIMING[racePhase(r.log)];
        const interest = interestSince(r.log, lastT, moments);
        due =
          since >= (phased ? phased.everyMs : silence) ||
          (interest >= (phased?.threshold ?? threshold) && since >= (phased?.minGapMs ?? minGapMs));
      }
      if (!due) return;
      if (live.current.voice && (isSpeaking(mode) || exchanging.current) && since < MAX_WAIT_FOR_VOICE_MS * 2) return;

      inFlight = true;
      setBusy(true);
      lastAt = now;
      silence = nextSilenceMs(everyMs);
      for (const m of moments) called.set(m.id, now);
      const snapshotT = now - Date.parse(r.log.startedAt);
      try {
        const text = await requestCommentary(
          apiBase,
          needsKey ? live.current.key : null,
          buildSnapshot(
            r.log,
            lastT,
            mode,
            moments,
            live.current.nameStyle,
            live.current.ridingSelf ? live.current.fitness : undefined,
          ),
          mode,
          live.current.duo,
        );
        lastT = snapshotT;
        setError(null);
        // The recording may have been stopped while the line was in flight.
        if (text && recorder.current === r && live.current.enabled) {
          r.radio(LINE_KIND[mode], text);
          setLines((prev) => [{ at: snapshotT, text }, ...prev].slice(0, SHOWN_LINES));
          if (live.current.voice) void live.current.say(text);
          live.current.onLine?.();
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
      stopSpeaking(mode);
    };
  }, [canRun, apiBase, needsKey, recorder, mode, pace]);

  const [latest, ...earlier] = lines;

  return (
    <section className={compact ? styles.overlayCard : styles.card}>
      <div className={styles.commentaryHeader}>
        <h2 className={styles.cardTitle}>{TITLE[mode]}</h2>
        <div className={styles.commentaryControls}>
          {busy && <span className={styles.commentaryBusy}>{mode === "tactics" ? "Thinking…" : "On air…"}</span>}
          {!switchesOutside && (
            <>
              <label className={styles.toggle}>
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                On
              </label>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={voice}
                  onChange={(e) => {
                    setVoice(e.target.checked);
                    if (!e.target.checked) stopSpeaking(mode);
                  }}
                />
                Voice
              </label>
            </>
          )}
          {compact && showSettings == null && (
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => setSettingsOpen((o) => !o)}
              aria-expanded={settingsOpen}
            >
              {settingsOpen ? "Done" : "Settings"}
            </button>
          )}
        </div>
      </div>

      {settingsOpen && (
        <div className={styles.voiceRow}>
          <label className={styles.toggle}>
            Session
            <select
              className={styles.voiceSelect}
              value={session}
              onChange={(e) => setSession(e.target.value as SessionChoice)}
              aria-label="Race or ride"
            >
              {SESSION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.toggle}>
            Names
            <select
              className={styles.voiceSelect}
              value={nameStyle}
              onChange={(e) => setNameStyle(e.target.value as NameStyle)}
              aria-label="How riders are named"
            >
              <option value="surname">Surname</option>
              <option value="first">First name</option>
              <option value="full">Full name</option>
            </select>
          </label>
          {mode === "commentary" && (
            <label className={styles.toggle}>
              Commentators
              <select
                className={styles.voiceSelect}
                value={storedDuo ? "two" : "one"}
                onChange={(e) => setDuo(e.target.value === "two")}
                aria-label="One commentator or two"
              >
                <option value="one">One</option>
                <option value="two">Two, talking to each other</option>
              </select>
            </label>
          )}
          {mode === "commentary" && (
            <label className={styles.toggle}>
              Pace
              <select
                className={styles.voiceSelect}
                value={pace}
                onChange={(e) => setPace(e.target.value as CommentaryPace)}
                aria-label="How often the commentator speaks"
              >
                {(Object.keys(COMMENTARY_PACE) as CommentaryPace[]).map((p) => (
                  <option key={p} value={p}>
                    {COMMENTARY_PACE[p].label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {voice && settingsOpen && (
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
              aria-label={`${TITLE[mode]} voice`}
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
                aria-label={`${TITLE[mode]} voice`}
              >
                {voices.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name}
                  </option>
                ))}
              </select>
            )
          )}
          {duo &&
            (engine === "natural" ? (
              <select className={styles.voiceSelect} value={coVoice} onChange={(e) => setCoVoice(e.target.value)} aria-label="Co-commentator voice">
                {NATURAL_VOICES.map((v) => (
                  <option key={v} value={v}>
                    Co: {v[0].toUpperCase() + v.slice(1)}
                  </option>
                ))}
              </select>
            ) : (
              voices.length > 1 && (
                <select
                  className={styles.voiceSelect}
                  value={voices.some((v) => v.name === coVoiceName) ? (coVoiceName ?? "") : voices[1].name}
                  onChange={(e) => setCoVoiceName(e.target.value)}
                  aria-label="Co-commentator voice"
                >
                  {voices.map((v) => (
                    <option key={v.name} value={v.name}>
                      Co: {v.name}
                    </option>
                  ))}
                </select>
              )
            ))}
          <button type="button" className={styles.secondaryButton} onClick={() => void say(duo ? DUO_TEST_LINE : TEST_LINE[mode])}>
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
            {mode === "tactics" ? "Tactics" : "Commentary"} needs a key from your site: open theultracyclist.com/dashboard/race, click{" "}
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
        <p className={styles.empty}>
          {mode === "commentary"
            ? "Start recording and the commentary begins with the race."
            : "Start recording and your coach starts calling the race: when to sit in, when to move, when to go."}
        </p>
      ) : !enabled ? (
        <p className={styles.empty}>{mode === "commentary" ? "Commentary" : "Tactics"} is off.</p>
      ) : !latest ? (
        <p className={styles.empty}>
          {mode === "commentary"
            ? "Warming up the commentary box…"
            : "Your coach is watching the gaps. Calls come only at key moments: a gap opening or closing, a split, a surge, a climb, the finale."}
        </p>
      ) : (
        <>
          <p className={compact ? styles.tacticLatest : styles.commentaryLatest}>
            <Spoken text={latest.text} />
          </p>
          {!compact && earlier.length > 0 && (
            <ol className={styles.commentaryEarlier}>
              {earlier.map((l) => (
                <li key={l.at}>
                  <Spoken text={l.text} />
                </li>
              ))}
            </ol>
          )}
        </>
      )}

      {mode === "tactics" && recording && !ridingSelf && (
        <p className={styles.voiceNote}>
          You're watching another rider, so the calls are for them. Tactics is meant for when you're racing.
        </p>
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

      {!needsKey && mode === "commentary" && <ModKeyButton />}
    </section>
  );
}

/** A line as shown: a two-commentator exchange turn by turn, with who's speaking; anything else as it is. */
function Spoken({ text }: { text: string }) {
  if (!/^\s*[AB]\s*:/m.test(text)) return <>{text}</>;
  return (
    <>
      {parseTurns(text).map((t, i) => (
        <span key={i} className={styles.turn}>
          <span className={`${styles.speaker} ${t.speaker === "B" ? styles.speakerCo : ""}`}>{t.speaker === "B" ? "Co" : "Lead"}</span>
          {t.text}
        </span>
      ))}
    </>
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
          ? "Copied - paste it into the mod's commentary or tactics box. It lasts 90 days."
          : state === "error"
            ? "Couldn't create a key - try signing in again."
            : "Only needed when running commentary from the Sauce mod."}
      </span>
      {token && state !== "copied" && <code className={styles.keyText}>{token}</code>}
    </div>
  );
}
