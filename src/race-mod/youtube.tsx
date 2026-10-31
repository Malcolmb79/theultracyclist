import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { OverlayShell, useSettings, type SettingDef } from "./overlay";
import { SITE } from "./site";
import shell from "./Overlay.module.css";
import styles from "./YouTube.module.css";

// The live chat from the rider's YouTube stream (streamed from OBS), over
// Zwift in the overlays' look - like the Zwift chat overlay, with avatars,
// the channel's own, moderators and members picked out, and Super Chats
// highlighted. Read through the site (api/_routes/youtube-chat.ts), which
// holds the YouTube key, with the race key the mod already uses.

const DEFAULTS = {
  opacity: 75,
  channel: "",
  example: false,
  direction: "up",
  messages: 6,
  fadeAfter: 120,
  avatars: true,
  every: 8,
  onlyLive: true,
};
const DEFS: SettingDef[] = [
  { key: "channel", label: "Your channel", type: "text", placeholder: "@yourhandle or stream link" },
  { key: "onlyLive", label: "Only show when I'm live", type: "toggle" },
  { key: "example", label: "Show an example (for placing it)", type: "toggle" },
  {
    key: "direction",
    label: "Direction",
    type: "select",
    options: [
      { value: "up", label: "Bottom to top" },
      { value: "down", label: "Top to bottom" },
    ],
  },
  { key: "messages", label: "Messages shown", type: "select", options: [3, 6, 10, 15].map((n) => ({ value: n, label: String(n) })) },
  {
    key: "fadeAfter",
    label: "Fade after",
    type: "select",
    options: [
      { value: 60, label: "1 minute" },
      { value: 120, label: "2 minutes" },
      { value: 300, label: "5 minutes" },
      { value: 0, label: "Never" },
    ],
  },
  { key: "avatars", label: "Pictures", type: "toggle" },
  {
    key: "every",
    label: "Check for messages every",
    type: "select",
    // YouTube allows about 10,000 reads' worth a day: every 8 seconds is a long stream's worth.
    options: [
      { value: 5, label: "5 seconds" },
      { value: 8, label: "8 seconds" },
      { value: 15, label: "15 seconds" },
    ],
  },
];

interface Message {
  id: string;
  author: string;
  avatar?: string;
  text: string;
  at: number;
  owner?: boolean;
  moderator?: boolean;
  member?: boolean;
  amount?: string;
}

interface Answer {
  configured?: boolean;
  live?: boolean;
  video?: { id: string; title?: string; channel?: string };
  chat?: string;
  messages?: Message[];
  page?: string;
  pollMs?: number;
  error?: string;
  ended?: boolean;
}

const KEPT = 60;

const EXAMPLE: Message[] = [
  { id: "1", author: "Hendo", text: "Go on Malcolm, bridge across!", at: Date.now() - 50_000 },
  { id: "2", author: "The Ultra Cyclist", text: "Thanks for watching - 3x10 sweet spot today", at: Date.now() - 40_000, owner: true },
  { id: "3", author: "Fingers", text: "What's the plan for the KOM?", at: Date.now() - 25_000, member: true },
  { id: "4", author: "Bite Mark", text: "For the fundraiser - keep going!", at: Date.now() - 12_000, amount: "€5.00" },
  { id: "5", author: "Mod Squad", text: "Be nice in chat folks", at: Date.now() - 4000, moderator: true },
];

/** The race key the mod's radio overlays already keep, shared by every mod window. */
function raceKey(): string | null {
  try {
    const raw = window.localStorage.getItem("race:commentary-key");
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return typeof v === "string" && v ? v : null;
  } catch {
    return null;
  }
}

function ago(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 5) return "now";
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
}

function YouTubeOverlay() {
  const [settings, set] = useSettings("youtube", DEFAULTS);
  const [messages, setMessages] = useState<Message[]>([]);
  const [state, setState] = useState<{ note?: string; title?: string; live?: boolean }>({});
  const cursor = useRef<{ chat?: string; page?: string; for: string }>({ for: "" });
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  const source = String(settings.channel ?? "").trim();
  useEffect(() => {
    if (settings.example) return;
    if (!source) {
      setState({ note: "Right-click and add your YouTube @handle to show your stream's chat" });
      return;
    }
    const key = raceKey();
    if (!key) {
      setState({ note: "Set your race key in the Race console window first - the chat comes through the site" });
      return;
    }
    if (cursor.current.for !== source) {
      cursor.current = { for: source };
      setMessages([]);
    }
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let wait = settings.every * 1000;
      try {
        const isLink = /youtu|v=|^[\w-]{11}$/.test(source) && !source.startsWith("@") && !/youtube\.com\/(@|channel\/|c\/)/.test(source);
        const q = new URLSearchParams(isLink ? { video: source } : { channel: source });
        if (cursor.current.chat) q.set("chat", cursor.current.chat);
        if (cursor.current.page) q.set("page", cursor.current.page);
        const res = await fetch(`${SITE}/api/youtube-chat?${q}`, { headers: { authorization: `Bearer ${key}` }, credentials: "omit" });
        const a = (await res.json().catch(() => ({}))) as Answer;
        if (!live) return;
        if (res.status === 401) setState({ note: "The site didn't accept the race key - set it again in the Race console" });
        else if (a.configured === false) setState({ note: "YouTube isn't set up on the site yet (YOUTUBE_API_KEY in Vercel)" });
        else if (!a.live) {
          setState({ note: a.error ?? "Not live right now - the chat appears when your stream starts" });
          // Ended or gone: start again from the channel next time.
          cursor.current = { for: source };
          wait = Math.max(wait, 30_000);
        } else {
          cursor.current = { for: source, chat: a.chat, page: a.page };
          setState({ title: a.video?.title, live: true });
          if (a.messages?.length) {
            setMessages((m) => {
              const seen = new Set(m.map((x) => x.id));
              return [...m, ...a.messages!.filter((x) => !seen.has(x.id))].slice(-KEPT);
            });
          }
          wait = Math.max(wait, a.pollMs ?? 0);
        }
      } catch {
        // A blip mid-stream keeps the chat up while it tries again.
        if (live) setState((st) => ({ ...st, note: "Can't reach the site - trying again" }));
        wait = Math.max(wait, 15_000);
      }
      if (live) timer = setTimeout(poll, wait);
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [source, settings.every, settings.example]);

  const now = Date.now();
  const all = settings.example ? EXAMPLE : messages;
  const shown = all.filter((m) => !settings.fadeAfter || now - m.at < settings.fadeAfter * 1000).slice(-settings.messages);
  const down = settings.direction === "down";
  if (down) shown.reverse();

  // Off air: nothing on screen if chosen - just the reason, on hover, for finding the window.
  if (settings.onlyLive && !settings.example && !state.live) {
    return (
      <OverlayShell title="YouTube chat" settings={settings} setSetting={set} defs={DEFS}>
        <div className={styles.idle}>{state.note ?? "Waiting for your stream"} · right-click for settings</div>
      </OverlayShell>
    );
  }

  return (
    <OverlayShell title="YouTube chat" settings={settings} setSetting={set} defs={DEFS}>
      {!settings.example && state.note && !shown.length ? (
        <p className={`${shell.panel} ${styles.note}`}>{state.note}</p>
      ) : (
        <ol className={`${styles.list} ${down ? styles.down : ""}`}>
          {shown.map((m) => (
            <li
              key={m.id}
              className={`${shell.panel} ${styles.item} ${m.amount ? styles.super : ""} ${m.owner ? styles.owner : ""}`}
            >
              {settings.avatars && (m.avatar ? <img className={styles.avatar} src={m.avatar} alt="" /> : <span className={styles.avatar}>{m.author.slice(0, 1)}</span>)}
              <span className={styles.body}>
                <span className={styles.head}>
                  <b className={m.moderator ? styles.mod : m.member ? styles.member : ""}>{m.author}</b>
                  {m.owner && <span className={styles.badge}>Host</span>}
                  {m.moderator && <span className={styles.badge}>Mod</span>}
                  {m.member && <span className={styles.badge}>Member</span>}
                  {m.amount && <span className={styles.amount}>{m.amount}</span>}
                  <span className={styles.ago}>{ago(now - m.at)}</span>
                </span>
                {m.text && <span className={styles.message}>{m.text}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </OverlayShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <YouTubeOverlay />
  </StrictMode>,
);
