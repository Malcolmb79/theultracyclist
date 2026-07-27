import { useEffect, useRef, useState } from "react";
import type { CoachingSettings, NarrativeInput } from "./types";
import { CHECKIN_TEMPLATE } from "./checkinTemplate";
import styles from "./CoachChatCard.module.css";

interface CoachChatCardProps {
  input: NarrativeInput;
  settings: CoachingSettings;
  onSaveSettings: (next: CoachingSettings) => Promise<void>;
  dataAvailable: boolean;
}

type ChatMessage = { role: "user" | "assistant"; content: string };

type CardStatus = "waiting" | "loading" | "unconfigured" | "error" | "ready";

export default function CoachChatCard({ input, settings, onSaveSettings, dataAvailable }: CoachChatCardProps) {
  const [status, setStatus] = useState<CardStatus>("loading");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [rulesDraft, setRulesDraft] = useState(settings.customRules ?? "");
  const [savingRules, setSavingRules] = useState(false);
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

  // Drops the fixed check-in template straight into the thread, same as
  // texting "checkin" to the WhatsApp coach - a local message, not an API
  // call, so it's guaranteed to be the exact template rather than
  // something the AI reproduces from memory (which could drift over time).
  const insertCheckinTemplate = () => {
    setMessages((prev) => [...prev, { role: "assistant", content: CHECKIN_TEMPLATE }]);
  };

  const send = () => {
    const text = draft.trim();
    if (!text || sending) return;

    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setDraft("");
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
            <button type="button" className={styles.rulesToggle} onClick={insertCheckinTemplate}>
              Check-in template
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
            {messages.map((message, i) => (
              <p key={i} className={message.role === "user" ? styles.userMessage : styles.text}>
                {message.content}
              </p>
            ))}
            {sending && <p className={styles.muted}>Thinking…</p>}
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
              placeholder="Ask the coach something…"
              disabled={sending}
            />
            <button type="submit" className={styles.sendButton} disabled={sending || !draft.trim()}>
              Send
            </button>
          </form>
        </>
      )}
    </div>
  );
}
