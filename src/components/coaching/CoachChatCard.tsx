import { useEffect, useRef, useState } from "react";
import type { NarrativeInput } from "./types";
import styles from "./CoachChatCard.module.css";

interface CoachChatCardProps {
  input: NarrativeInput;
}

type ChatMessage = { role: "user" | "assistant"; content: string };

type CardStatus = "loading" | "unconfigured" | "error" | "ready";

export default function CoachChatCard({ input }: CoachChatCardProps) {
  const [status, setStatus] = useState<CardStatus>("loading");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setMessages([]);

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

    return () => {
      cancelled = true;
    };
    // Re-fetch only when the underlying stats actually change, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(input)]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, sending]);

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
      <span className={styles.eyebrow}>Coach's chat</span>

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
