import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import RadioCard from "../components/race/RadioCard";
import { RaceRecorder } from "../components/race/raceLog";
import {
  athleteName,
  connectSauce,
  sauceAddressForModPage,
  type FeedStatus,
  type SauceAthleteData,
} from "../components/race/sauceFeed";
import { useEventBrief } from "../components/race/eventInfo";
import { SITE } from "./site";
import styles from "./Tactics.module.css";

/**
 * The tactics coach as a Sauce overlay: a small window over Zwift that
 * shows the latest call and speaks it, running alongside the console's
 * commentary. It follows the race itself - its own Sauce connection and its
 * own in-memory record of the race, never saved - so it works whether or
 * not the console is open or recording.
 */
function TacticsOverlay() {
  const [status, setStatus] = useState<FeedStatus>("connecting");
  const [watching, setWatching] = useState<SauceAthleteData | null>(null);
  const recorder = useRef<RaceRecorder | null>(new RaceRecorder());
  const address = useMemo(() => sauceAddressForModPage(), []);
  useEventBrief(address, watching?.state?.eventSubgroupId, recorder);

  useEffect(() => {
    document.documentElement.classList.add(styles.transparent);
    return connectSauce(address, {
      onStatus: setStatus,
      onWatching: (data) => {
        setWatching(data);
        recorder.current?.watching(data);
      },
      onGroups: (g) => recorder.current?.groups(g),
      onChat: (c) => recorder.current?.chat(c),
    });
  }, [address]);

  return (
    <div className={styles.overlay}>
      <div className={styles.strip}>
        <span className={`${styles.dot} ${status === "connected" ? styles.on : styles.off}`} aria-hidden />
        <span className={styles.rider}>{watching ? athleteName(watching) : "Waiting for Zwift…"}</span>
        {watching?.eventPosition ? (
          <span className={styles.meta}>
            {watching.eventPosition}/{watching.eventParticipants ?? "?"}
          </span>
        ) : null}
        {watching?.wBal != null && <span className={styles.meta}>W′ {(watching.wBal / 1000).toFixed(1)} kJ</span>}
      </div>
      <RadioCard
        mode="tactics"
        compact
        recorder={recorder}
        recording={status === "connected"}
        apiBase={SITE}
        needsKey
        ridingSelf={!!watching?.self}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TacticsOverlay />
  </StrictMode>,
);
