import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { OverlayShell, useSettings, type SettingDef } from "./overlay";
import shell from "./Overlay.module.css";
import styles from "./Discord.module.css";

// Your Discord voice channel over Zwift, the way StreamKit shows it in OBS -
// who's in it, who's talking (lit up in the theme's accent), who's muted -
// in the overlays' own look.
//
// Discord only shares voice activity with programs on the computer, not
// web pages, so this reads it from the Ultra Cyclist Discord bridge
// (discord-bridge/bridge.mjs), which the rider runs beside Sauce.

const DEFAULTS = { opacity: 0, example: false, layout: "vertical", show: "all", names: true, speakingFirst: false, hideWhenEmpty: false, port: 8723 };
const DEFS: SettingDef[] = [
  { key: "example", label: "Show an example (for placing it)", type: "toggle" },
  {
    key: "layout",
    label: "Layout",
    type: "select",
    options: [
      { value: "vertical", label: "A list" },
      { value: "horizontal", label: "A row" },
    ],
  },
  {
    key: "show",
    label: "Show",
    type: "select",
    options: [
      { value: "all", label: "Everyone in the channel" },
      { value: "speaking", label: "Only who's talking" },
    ],
  },
  { key: "names", label: "Names", type: "toggle" },
  { key: "speakingFirst", label: "Who's talking first", type: "toggle" },
  { key: "hideWhenEmpty", label: "Hide when not in a channel", type: "toggle" },
  { key: "port", label: "Bridge port", type: "select", options: [8723, 8724, 8725, 8726].map((p) => ({ value: p, label: String(p) })) },
];

interface Member {
  id: string;
  name: string;
  avatar: string;
  speaking: boolean;
  mute: boolean;
  deaf: boolean;
}

interface Feed {
  status: string;
  message?: string;
  channel: { id: string; name: string } | null;
  members: Member[];
}

const EXAMPLE: Feed = {
  status: "ready",
  channel: { id: "0", name: "Race radio" },
  members: [
    { id: "1", name: "You", avatar: "", speaking: true, mute: false, deaf: false },
    { id: "2", name: "Hendo", avatar: "", speaking: false, mute: false, deaf: false },
    { id: "3", name: "Fingers", avatar: "", speaking: false, mute: true, deaf: false },
    { id: "4", name: "Bite Mark", avatar: "", speaking: false, mute: true, deaf: true },
  ],
};

/** The bridge's feed: everything at once, again on every change. Null until it answers. */
function useBridge(port: number, on: boolean): Feed | null {
  const [feed, setFeed] = useState<Feed | null>(null);
  useEffect(() => {
    if (!on) return;
    setFeed(null);
    const source = new EventSource(`http://127.0.0.1:${port}/events`);
    source.onmessage = (e) => {
      try {
        setFeed(JSON.parse(e.data) as Feed);
      } catch {
        // A bad message; the next one replaces it.
      }
    };
    // Not running (yet): EventSource keeps retrying on its own.
    source.onerror = () => setFeed(null);
    return () => source.close();
  }, [port, on]);
  return feed;
}

function DiscordOverlay() {
  const [settings, set] = useSettings("discord", DEFAULTS);
  const live = useBridge(Number(settings.port) || DEFAULTS.port, !settings.example);
  const feed = settings.example ? EXAMPLE : live;

  let members = feed?.members ?? [];
  if (settings.show === "speaking") members = members.filter((m) => m.speaking);
  if (settings.speakingFirst) members = [...members].sort((a, b) => Number(b.speaking) - Number(a.speaking));

  const problem = !feed
    ? "Start the Discord bridge (start.bat) to show your voice channel"
    : feed.status !== "ready"
      ? (feed.message ?? "Waiting for Discord…")
      : null;
  if (settings.hideWhenEmpty && (problem || !feed?.channel)) {
    return (
      <OverlayShell title="Discord voice" settings={settings} setSetting={set} defs={DEFS}>
        <div className={styles.idle}>{problem ?? "Discord voice appears when you join a channel"} · right-click for settings</div>
      </OverlayShell>
    );
  }

  return (
    <OverlayShell title="Discord voice" settings={settings} setSetting={set} defs={DEFS}>
      <div className={`${shell.panel} ${styles.panel} ${settings.layout === "horizontal" ? styles.horizontal : styles.vertical}`}>
        {problem ? (
          <p className={styles.waiting}>{problem}</p>
        ) : (
          <>
            {feed?.channel && (
              <div className={styles.channel}>
                <span className={styles.hash}>🔊</span>
                {feed.channel.name}
                {settings.example && <span className={styles.exampleTag}>Example</span>}
              </div>
            )}
            <ul className={styles.members}>
              {members.map((m) => (
                <li key={m.id} className={`${styles.member} ${m.speaking ? styles.speaking : ""} ${m.mute || m.deaf ? styles.muted : ""}`}>
                  <span className={styles.avatarWrap}>
                    <Avatar m={m} />
                    {(m.mute || m.deaf) && (
                      <span className={styles.badge} title={m.deaf ? "Deafened" : "Muted"}>
                        {m.deaf ? <DeafIcon /> : <MuteIcon />}
                      </span>
                    )}
                  </span>
                  {settings.names && <span className={styles.name}>{m.name}</span>}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </OverlayShell>
  );
}

/** Their Discord avatar, or their initial if it can't be loaded. */
function Avatar({ m }: { m: Member }) {
  const [failed, setFailed] = useState(false);
  if (!m.avatar || failed) return <span className={`${styles.avatar} ${styles.initial}`}>{m.name.slice(0, 1).toUpperCase()}</span>;
  return <img className={styles.avatar} src={m.avatar} alt="" onError={() => setFailed(true)} />;
}

function MuteIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3M4 4l16 16" />
    </svg>
  );
}

function DeafIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
      <path d="M4 15h3v5H5a1 1 0 0 1-1-1zM20 15h-3v5h2a1 1 0 0 0 1-1zM4 4l16 16" />
    </svg>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DiscordOverlay />
  </StrictMode>,
);
