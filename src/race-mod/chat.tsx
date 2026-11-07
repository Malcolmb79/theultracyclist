import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { OverlayShell, useSettings, type SettingDef, Recover } from "./overlay";
import { useSauce } from "./useSauce";
import { hrColour, zoneColor } from "./zones";
import { useFlags } from "./flags";
import { Avatar } from "./nearbyAvatar";
import shell from "./Overlay.module.css";
import styles from "./Chat.module.css";

// Chat and Ride Ons - the bubbles Zwift stacks on the right - stacking up
// from the bottom (newest at the bottom) or down from the top (newest at the
// top), fading out after a while so the screen clears when it's quiet.

const DEFAULTS = { opacity: 75, direction: "up", messages: 5, fadeAfter: 60, rideOns: true, avatars: true, flags: true, gap: true, power: true, hr: true };
const DEFS: SettingDef[] = [
  {
    key: "direction",
    label: "Direction",
    type: "select",
    options: [
      { value: "up", label: "Bottom to top" },
      { value: "down", label: "Top to bottom" },
    ],
  },
  { key: "messages", label: "Messages shown", type: "select", options: [3, 5, 8, 12, 16, 20, 30, 40, 50].map((n) => ({ value: n, label: String(n) })) },
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
  { key: "avatars", label: "Their picture", type: "toggle" },
  { key: "flags", label: "Their country flag", type: "toggle" },
  { key: "gap", label: "How far ahead or behind they are", type: "toggle" },
  { key: "power", label: "Their power now", type: "toggle" },
  { key: "hr", label: "Their heart rate now", type: "toggle" },
];

/** "12s ahead", "8s behind", "with you" - from Sauce's gap to the rider being watched. */
function gapText(gap: number): string {
  const s = Math.round(Math.abs(gap));
  if (s < 1) return "with you";
  const t = s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s}s`;
  return gap < 0 ? `${t} ahead` : `${t} behind`;
}

function ago(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 5) return "now";
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
}

function ChatOverlay() {
  const [settings, set] = useSettings("chat", DEFAULTS);
  const { chat, watching, nearby, address } = useSauce({ chat: true, nearby: true });
  const flags = useFlags(address);
  const onRoad = new Map(nearby.map((r) => [r.athleteId, r]));
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
  // Top to bottom: anchored at the top with the newest first, pushing older ones down.
  const down = settings.direction === "down";
  if (down) shown.reverse();

  return (
    <OverlayShell title="Chat" settings={settings} setSetting={set} defs={DEFS}>
      <ol className={`${styles.list} ${down ? styles.down : ""}`}>
        {shown.map((c) => (
          <li key={c.id} className={`${shell.panel} ${styles.item} ${c.kind === "rideon" ? styles.rideOn : ""}`}>
            <span className={styles.head}>
              {(() => {
                // Who they are, where they are and how they're riding now - if they're on the road nearby.
                const r = c.from != null ? onRoad.get(c.from) : undefined;
                const me = !!r && r.athleteId === watching?.athleteId;
                const flag = settings.flags && r?.athlete?.countryCode != null ? flags.get(r.athlete.countryCode) : undefined;
                const ftp = r?.athlete?.ftp;
                const w = r?.state?.power;
                const hr = r?.state?.heartrate;
                return (
                  <span className={styles.who}>
                    {settings.avatars && r && <Avatar r={r} />}
                    {flag && <img className={styles.flag} src={flag.src} alt={flag.name} title={flag.name} />}
                    <b>{c.name}</b>
                    {r && !me && (
                      <span className={styles.live}>
                        {settings.gap && r.gap != null && <span className={styles.gap}>{gapText(r.gap)}</span>}
                        {settings.power && w != null && (
                          <span style={{ color: ftp ? zoneColor(w / ftp) : undefined }}>{Math.round(w)} W</span>
                        )}
                        {settings.hr && hr ? <span style={{ color: hrColour(r, hr) }}>{hr} ♥</span> : null}
                      </span>
                    )}
                  </span>
                );
              })()}
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
    <Recover>
      <ChatOverlay />
    </Recover>
  </StrictMode>,
);
