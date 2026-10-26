import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { powerUp } from "../components/race/powerUps";
import { connectSauce, sauceAddressForModPage, sauceRpc, type SauceAthleteData, type SauceGameState } from "../components/race/sauceFeed";
import { OverlayShell, useSettings, type SettingDef } from "./overlay";
import shell from "./Overlay.module.css";
import PowerUpIcon from "./PowerUpIcon";
import styles from "./PowerUp.module.css";

// In the theme's accent colour, like the rest of the overlays.
//
// The power-up the rider is holding, as Zwift shows it beside the power -
// the Feather, the Van, the Aero helmet - with what it does, and once it's
// used, the one running with a countdown to when it ends.
//
// The held power-up only reaches Sauce over its Game Connection (the link
// Zwift's Companion app uses), so without that only the running one shows,
// from the rider's state.

// The badge fills the window, so resizing the window sizes the badge; the
// name, the seconds left and what it does sit under it, each switched on
// in the settings.
const DEFAULTS = { opacity: 0, example: false, showName: false, showSeconds: false, showEffect: false, hideWhenEmpty: false };
const DEFS: SettingDef[] = [
  { key: "example", label: "Show an example (for placing it)", type: "toggle" },
  { key: "showName", label: "Name", type: "toggle" },
  { key: "showSeconds", label: "Seconds left", type: "toggle" },
  { key: "showEffect", label: "What it does", type: "toggle" },
  { key: "hideWhenEmpty", label: "Hide when there's none", type: "toggle" },
];


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

  const fraction = shown?.running && left != null ? Math.min(1, left / total.current) : null;
  const seconds = settings.showSeconds && shown?.running && left != null ? `${Math.ceil(left)}s` : null;
  // Room under the badge for whatever's switched on, so the badge takes the rest of the window.
  const labelsRem = (settings.showName ? 1.8 : 0) + (seconds ? 1.6 : 0) + (settings.showEffect && shown?.p.effect ? 2.4 : 0) + (example ? 1.1 : 0);

  return (
    <OverlayShell title="Power-up" settings={settings} setSetting={set} defs={DEFS}>
      <div
        className={`${shell.panel} ${styles.panel} ${shown?.running ? styles.running : ""}`}
        style={{ ["--pu" as string]: shown ? "var(--color-accent-2)" : "var(--color-text-muted)", ["--labels" as string]: `${labelsRem}rem` }}
      >
        {shown ? (
          <>
            <span className={styles.badgeWrap} aria-hidden>
              <span className={styles.badge}>
                <PowerUpIcon code={shown.code} />
              </span>
              {fraction != null && (
                // Draining round the badge as it runs out, the way Zwift shows it.
                <svg className={styles.ring} viewBox="0 0 44 44">
                  <circle className={styles.ringTrack} cx="22" cy="22" r={RING_R} />
                  <circle
                    className={styles.ringLeft}
                    cx="22"
                    cy="22"
                    r={RING_R}
                    strokeDasharray={RING_C}
                    strokeDashoffset={RING_C * (1 - fraction)}
                  />
                </svg>
              )}
            </span>
            {settings.showName && <span className={styles.name}>{shown.p.name}</span>}
            {seconds && <span className={styles.state}>{seconds}</span>}
            {settings.showEffect && shown.p.effect && <p className={styles.effect}>{shown.p.effect}</p>}
            {example && <span className={styles.exampleTag}>Example</span>}
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
