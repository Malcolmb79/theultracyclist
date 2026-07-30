import { useEffect, useRef, useState } from "react";
import type { CoachingSettings, NarrativeInput } from "./types";
import { WEEKLY_CHECKIN_QUESTIONS, buildWeeklyCheckinMessage } from "./weeklyCheckin";
import ChatWidgetMessage, { type ChatWidgetData } from "./ChatWidgetMessage";
import styles from "./CoachChatCard.module.css";

interface CoachChatCardProps {
  input: NarrativeInput;
  settings: CoachingSettings;
  onSaveSettings: (next: CoachingSettings) => Promise<void>;
  dataAvailable: boolean;
  // Live dashboard data, so a reply containing a [widget:...] marker can render
  // the real widget inline (see ChatWidgetMessage). Optional: without it the
  // reply still shows, just as plain text.
  widgetData?: ChatWidgetData;
}

type ChatMessage = { role: "user" | "assistant"; content: string };

type CardStatus = "waiting" | "loading" | "unconfigured" | "error" | "ready";

// Walks through WEEKLY_CHECKIN_QUESTIONS one at a time ("asking"), then
// shows the assembled result for a yes/no before actually sending
// ("confirming") - a plain state machine local to this component, not
// persisted, since a half-finished check-in isn't worth resuming later.
type CheckinState = { phase: "asking"; step: number; answers: string[] } | { phase: "confirming"; answers: string[] };

export default function CoachChatCard({ input, settings, onSaveSettings, dataAvailable, widgetData }: CoachChatCardProps) {
  const [status, setStatus] = useState<CardStatus>("loading");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [rulesDraft, setRulesDraft] = useState(settings.customRules ?? "");
  const [savingRules, setSavingRules] = useState(false);
  const [checkin, setCheckin] = useState<CheckinState | null>(null);
  const [sendingCheckin, setSendingCheckin] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setRulesDraft(settings.customRules ?? "");
  }, [settings.customRules]);

  const saveRules = async () => {
    setSavingRules(true);
    try {
      await onSaveSettings({ ...settings, customRules: rulesDraft.trim() || undefined });
      setRulesOpen(false);
    } finally {
      setSavingRules(false);
    }
  };

  useEffect(() => {
    if (!dataAvailable) {
      setStatus("waiting");
      setMessages([]);
      return;
    }

    let cancelled = false;
    setStatus("loading");
    setMessages([]);

    // A short deliberate pause before the first read of the session - gives
    // a just-finished ride or overnight Whoop sync a few extra seconds to
    // land before the coach forms an opinion on stale data.
    const timer = setTimeout(() => {
      if (cancelled) return;

      fetch("/api/coaching-narrative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      })
        .then((res) => res.json())
        .then((body: { configured: boolean; text?: string }) => {
          if (cancelled) return;
          if (!body.configured) {
            setStatus("unconfigured");
          } else {
            setMessages([{ role: "assistant", content: body.text ?? "" }]);
            setStatus("ready");
          }
        })
        .catch(() => {
          if (!cancelled) setStatus("error");
        });
    }, 10_000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // Re-fetch only when the underlying stats (or data availability) actually change, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(input), dataAvailable]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, sending]);

  // Starts the question-by-question flow instead of dumping the whole
  // template at once - each reply here is a local state transition, not an
  // AI call, so the questions themselves can't drift or get reworded.
  const startWeeklyCheckin = () => {
    setCheckin({ phase: "asking", step: 0, answers: [] });
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: `Let's do your weekly check-in.\n\n${WEEKLY_CHECKIN_QUESTIONS[0]}` },
    ]);
  };

  const sendCheckinToWhatsApp = (finalMessage: string) => {
    setSendingCheckin(true);
    fetch("/api/send-checkin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: finalMessage }),
    })
      .then((res) => res.json())
      .then((body: { sent: boolean; reason?: string }) => {
        if (body.sent) {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: "Sent! Don't forget your front/side/rear photos too." },
          ]);
          return;
        }
        const why =
          body.reason === "not_configured"
            ? "I can't send WhatsApp messages yet - that needs setting up first."
            : "Couldn't send that automatically.";
        setMessages((prev) => [...prev, { role: "assistant", content: `${why} Here's the text to send yourself:\n\n${finalMessage}` }]);
      })
      .catch(() => {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Couldn't send that automatically. Here's the text to send yourself:\n\n${finalMessage}` },
        ]);
      })
      .finally(() => setSendingCheckin(false));
  };

  // Interprets a reply as either the answer to the current question, or -
  // once every question's been asked - a yes/no on whether to actually
  // send the assembled result.
  const handleCheckinReply = (text: string) => {
    setMessages((prev) => [...prev, { role: "user", content: text }]);

    if (checkin?.phase === "asking") {
      const nextAnswers = [...checkin.answers, text];
      const nextStep = checkin.step + 1;
      if (nextStep < WEEKLY_CHECKIN_QUESTIONS.length) {
        setCheckin({ phase: "asking", step: nextStep, answers: nextAnswers });
        setMessages((prev) => [...prev, { role: "assistant", content: WEEKLY_CHECKIN_QUESTIONS[nextStep] }]);
      } else {
        setCheckin({ phase: "confirming", answers: nextAnswers });
        const finalMessage = buildWeeklyCheckinMessage(nextAnswers);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Here's your completed check-in:\n\n${finalMessage}\n\nSend this to your coach via WhatsApp? (yes/no)` },
        ]);
      }
      return;
    }

    if (checkin?.phase === "confirming") {
      const finalMessage = buildWeeklyCheckinMessage(checkin.answers);
      setCheckin(null);
      if (/^y(es)?$/i.test(text.trim())) {
        sendCheckinToWhatsApp(finalMessage);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: 'No problem, cancelled - click "Weekly check-in" again whenever you\'re ready.' },
        ]);
      }
    }
  };

  const send = () => {
    const text = draft.trim();
    if (!text || sending || sendingCheckin) return;
    setDraft("");

    if (checkin) {
      handleCheckinReply(text);
      return;
    }

    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setSending(true);

    fetch("/api/coaching-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: next, context: input }),
    })
      .then((res) => res.json())
      .then((body: { configured: boolean; reply?: string }) => {
        if (!body.configured) {
          setStatus("unconfigured");
          return;
        }
        setMessages((prev) => [...prev, { role: "assistant", content: body.reply ?? "Sorry, I didn't catch that." }]);
      })
      .catch(() => {
        setMessages((prev) => [...prev, { role: "assistant", content: "Something went wrong sending that - try again." }]);
      })
      .finally(() => setSending(false));
  };

  return (
    <div className={styles.card}>
      <div className={styles.headerRow}>
        <span className={styles.eyebrow}>My AI Coach</span>
        <div className={styles.headerActions}>
          {status === "ready" && (
            <button type="button" className={styles.rulesToggle} onClick={startWeeklyCheckin} disabled={checkin != null}>
              Weekly check-in
            </button>
          )}
          <button
            type="button"
            className={styles.rulesToggle}
            onClick={() => setRulesOpen((open) => !open)}
            aria-expanded={rulesOpen}
          >
            {rulesOpen ? "Hide rules" : "Coach rules"}
          </button>
        </div>
      </div>

      {rulesOpen && (
        <div className={styles.rulesEditor}>
          <textarea
            className={styles.rulesTextarea}
            value={rulesDraft}
            onChange={(e) => setRulesDraft(e.target.value)}
            placeholder="Standing instructions for the coach - dietary restrictions, injuries, tone preferences, anything it should always factor in…"
            rows={4}
          />
          <button type="button" className={styles.rulesSave} onClick={saveRules} disabled={savingRules}>
            {savingRules ? "Saving…" : "Save rules"}
          </button>
        </div>
      )}

      {status === "waiting" && <p className={styles.muted}>Waiting for today's Whoop/Strava data to load…</p>}
      {status === "loading" && <p className={styles.muted}>Generating…</p>}
      {status === "error" && <p className={styles.muted}>Couldn't reach the coach right now.</p>}
      {status === "unconfigured" && (
        <p className={styles.muted}>
          Add an <code>ANTHROPIC_API_KEY</code> in Vercel's project environment variables to enable the AI coach.
          Everything else on this page works without it.
        </p>
      )}

      {status === "ready" && (
        <>
          <div className={styles.messages} ref={listRef}>
            {messages.map((message, i) =>
              message.role === "user" ? (
                <p key={i} className={styles.userMessage}>
                  {message.content}
                </p>
              ) : (
                <ChatWidgetMessage key={i} content={message.content} data={widgetData} />
              ),
            )}
            {sending && <p className={styles.muted}>Thinking…</p>}
            {sendingCheckin && <p className={styles.muted}>Sending…</p>}
          </div>
          <form
            className={styles.composer}
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input
              className={styles.input}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={checkin ? "Type your answer…" : "Ask the coach something…"}
              disabled={sending || sendingCheckin}
            />
            <button type="submit" className={styles.sendButton} disabled={sending || sendingCheckin || !draft.trim()}>
              Send
            </button>
          </form>
        </>
      )}
    </div>
  );
}
