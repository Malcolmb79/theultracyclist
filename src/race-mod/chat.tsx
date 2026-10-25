import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { OverlayShell, useSettings, type SettingDef } from "./overlay";
import { useSauce } from "./useSauce";
import shell from "./Overlay.module.css";
import styles from "./Chat.module.css";

// Chat and Ride Ons - the bubbles Zwift stacks on the right - newest at the
// bottom, fading out after a while so the screen clears when it's quiet.

const DEFAULTS = { opacity: 75, messages: 5, fadeAfter: 60, rideOns: true };
const DEFS: SettingDef[] = [
  { key: "messages", label: "Messages shown", type: "select", options: [3, 5, 8, 12].map((n) => ({ value: n, label: String(n) })) },
  {
    key: "fadeAfter",
    label: "Fade after",
    type: "select",
    options: [
      { value: 30, label: "30 seconds" },
      { value: 60, label: "1 minute" },
      { value: 180, label: "3 minutes" },
      { value: 0, label: "Never" },
    ],
  },
  { key: "rideOns", label: "Ride Ons", type: "toggle" },
];

function ago(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 5) return "now";
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
}

function ChatOverlay() {
  const [settings, set] = useSettings("chat", DEFAULTS);
  const { chat, watching } = useSauce({ chat: true });
  // Re-render every few seconds so "ago" and fading keep up.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);
  const now = Date.now();

  const shown = chat
    .filter((c) => settings.rideOns || c.kind === "chat")
    .filter((c) => !settings.fadeAfter || now - c.at < settings.fadeAfter * 1000)
    .slice(-settings.messages);

  return (
    <OverlayShell title="Chat" settings={settings} setSetting={set} defs={DEFS}>
      <ol className={styles.list}>
        {shown.map((c) => (
          <li key={c.id} className={`${shell.panel} ${styles.item} ${c.kind === "rideon" ? styles.rideOn : ""}`}>
            <span className={styles.head}>
              <b>{c.name}</b>
              <span className={styles.ago}>{ago(now - c.at)}</span>
            </span>
            {c.kind === "chat" ? (
              <span className={styles.message}>{c.message}</span>
            ) : (
              <span className={styles.message}>
                {c.to != null && c.to === watching?.athleteId ? "Ride On! 👍 to you" : "Ride On! 👍"}
              </span>
            )}
          </li>
        ))}
      </ol>
    </OverlayShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ChatOverlay />
  </StrictMode>,
);
