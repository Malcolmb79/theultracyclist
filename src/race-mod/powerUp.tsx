import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { powerUp } from "../components/race/powerUps";
import { connectSauce, sauceAddressForModPage, sauceRpc, type SauceAthleteData, type SauceGameState } from "../components/race/sauceFeed";
import { OverlayShell, useSettings, type SettingDef } from "./overlay";
import shell from "./Overlay.module.css";
import PowerUpIcon from "./PowerUpIcon";
import styles from "./PowerUp.module.css";

// The power-up the rider is holding, as Zwift shows it beside the power -
// the Feather, the Van, the Aero helmet - with what it does, and once it's
// used, the one running with a countdown to when it ends.
//
// The held power-up only reaches Sauce over its Game Connection (the link
// Zwift's Companion app uses), so without that only the running one shows,
// from the rider's state.

const DEFAULTS = { opacity: 80, example: false, effect: true, hideWhenEmpty: false };
const DEFS: SettingDef[] = [
  { key: "example", label: "Show an example (for placing it)", type: "toggle" },
  { key: "effect", label: "What it does", type: "toggle" },
  { key: "hideWhenEmpty", label: "Hide when there's none", type: "toggle" },
];

/** A colour for each power-up, so it reads at a glance. */
const COLOUR: Record<string, string> = {
  LIGHTNESS: "#f5f6f7",
  DRAFTBOOST: "#2ee6a6",
  AERO: "#4da3ff",
  UNDRAFTABLE: "#ff9a2e",
  NINJA: "#b48cff",
  STEAMROLLER: "#ffd23f",
  ANVIL: "#9aa4ae",
  COFFEE_STOP: "#c68b59",
  BOOST: "#ff4d2e",
};

/** The countdown ring's radius and length, in the ring's own 44-unit box. */
const RING_R = 20.5;
const RING_C = 2 * Math.PI * RING_R;

function PowerUpOverlay() {
  const [settings, set] = useSettings("powerUp", DEFAULTS);
  const address = useMemo(() => sauceAddressForModPage(), []);
  const [game, setGame] = useState<SauceGameState | null>(null);
  const [watching, setWatching] = useState<SauceAthleteData | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    // The game state as it is now, then every change to it.
    void sauceRpc<SauceGameState>(address, "getGameState")
      .then((g) => g && setGame(g))
      .catch(() => undefined);
    return connectSauce(address, {
      onStatus: () => undefined,
      onWatching: setWatching,
      onGameState: setGame,
    });
  }, [address]);

  // The countdown, measured against how long this one runs.
  const end = game?.activePowerUpEnd;
  const total = useRef(30);
  useEffect(() => {
    if (!end) return;
    total.current = Math.max(1, (end - Date.now()) / 1000);
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [end]);

  // The held power-up is the rider's own only while they're the one being watched.
  const self = watching?.self ?? true;
  const held = self ? powerUp(game?.availablePowerUp ?? undefined) : undefined;
  const activeCode = (self ? game?.activePowerUp : null) ?? watching?.state?.activePowerUp;
  const active = powerUp(activeCode ?? undefined);
  const left = end && active ? Math.max(0, (end - Date.now()) / 1000) : undefined;
  const connected = !!game?.gameConnection;

  // The example: a power-up held, as it would show, to size and place the window by.
  const example = settings.example ? powerUp("AERO") : undefined;
  const shown = example
    ? { code: "AERO", p: example, running: false }
    : active
      ? { code: activeCode!, p: active, running: true }
      : held
        ? { code: game!.availablePowerUp!, p: held, running: false }
        : null;
  if (!shown && settings.hideWhenEmpty) {
    return (
      <OverlayShell title="Power-up" settings={settings} setSetting={set} defs={DEFS}>
        <div className={styles.idle}>Power-up appears when you pick one up · right-click for settings</div>
      </OverlayShell>
    );
  }

  return (
    <OverlayShell title="Power-up" settings={settings} setSetting={set} defs={DEFS}>
      <div className={`${shell.panel} ${styles.panel} ${shown?.running ? styles.running : ""}`} style={{ ["--pu" as string]: shown ? (COLOUR[shown.code] ?? "var(--color-accent-2)") : "var(--color-text-muted)" }}>
        {shown ? (
          <>
            <div className={styles.head}>
              <span className={styles.badgeWrap} aria-hidden>
                <span className={styles.badge}>
                  <PowerUpIcon code={shown.code} />
                </span>
                {shown.running && left != null && (
                  // Draining round the badge as it runs out, the way Zwift shows it.
                  <svg className={styles.ring} viewBox="0 0 44 44">
                    <circle className={styles.ringTrack} cx="22" cy="22" r={RING_R} />
                    <circle
                      className={styles.ringLeft}
                      cx="22"
                      cy="22"
                      r={RING_R}
                      strokeDasharray={RING_C}
                      strokeDashoffset={RING_C * (1 - Math.min(1, left / total.current))}
                    />
                  </svg>
                )}
              </span>
              <span className={styles.name}>{shown.p.name}</span>
              <span className={styles.state}>{example ? "Example" : shown.running ? (left != null ? `${Math.ceil(left)}s` : "On") : "Ready"}</span>
            </div>
            {settings.effect && shown.p.effect && <p className={styles.effect}>{shown.p.effect}</p>}
            {shown.running && left != null && (
              <div className={styles.timer} aria-hidden>
                <span style={{ width: `${Math.min(100, (left / total.current) * 100)}%` }} />
              </div>
            )}
          </>
        ) : (
          <p className={styles.none}>
            {connected
              ? "No power-up - ride through an arch to pick one up."
              : "No power-up. To see the one you're holding, turn on Sauce's Game Connection (Sauce settings)."}
          </p>
        )}
      </div>
    </OverlayShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PowerUpOverlay />
  </StrictMode>,
);
