import { useEffect, useRef, useState } from "react";
import { useStoredState } from "../../utils/useStoredState";
import StatTile from "../shared/StatTile";
import RadioCard from "./RadioCard";
import {
  DEFAULT_SAUCE_ADDRESS,
  athleteName,
  connectSauce,
  localNetworkPermission,
  type FeedStatus,
  type SauceAthleteData,
  type SauceGroup,
} from "./sauceFeed";
import {
  RaceRecorder,
  archiveLog,
  downloadLog,
  formatElapsed,
  loadCurrentLog,
  loadSavedLogs,
  saveCurrentLog,
  type RaceEvent,
  type RaceLog,
} from "./raceLog";
import styles from "./RaceConsole.module.css";

/** Often enough that a crash costs seconds, not the race. */
const AUTOSAVE_MS = 10_000;
const FEED_EVENTS = 25;

/** The race log list: commentary and tactics have their own card, so they're left out here. */
function feed(log: RaceLog): RaceEvent[] {
  return log.events.filter((e) => e.kind !== "commentary" && e.kind !== "tactic").slice(-FEED_EVENTS);
}

/**
 * The live race console: the Sauce connection, the watched rider's numbers,
 * the groups on the road and the race log. Shared by the dashboard's Race
 * page and the Sauce mod (sauce-mod/), which serves it from Sauce itself so
 * Chrome's local network rules never come into it.
 */
export default function RaceConsole({
  defaultAddress = DEFAULT_SAUCE_ADDRESS,
  apiBase = "",
  needsKey = false,
  tacticsOverlay = false,
}: {
  defaultAddress?: string;
  /** Where the site's API lives: "" on the site itself, its URL from the mod. */
  apiBase?: string;
  /** The mod can't use the site's session, so commentary needs a key. */
  needsKey?: boolean;
  /** In the mod, tactics lives in its own Sauce overlay window instead. */
  tacticsOverlay?: boolean;
}) {
  const [address, setAddress] = useStoredState("race:sauce-address", defaultAddress, (v) =>
    typeof v === "string" && v.trim() ? v : null,
  );
  const [addressDraft, setAddressDraft] = useState(address);
  const [status, setStatus] = useState<FeedStatus>("connecting");
  // Sticks once an attempt fails, so the help stays up through the retries
  // rather than flickering with each "connecting".
  const [failed, setFailed] = useState(false);
  const [permission, setPermission] = useState<PermissionState | null>(null);
  const [watching, setWatching] = useState<SauceAthleteData | null>(null);
  const [groups, setGroups] = useState<SauceGroup[]>([]);
  const [recording, setRecording] = useState(false);
  const [events, setEvents] = useState<RaceEvent[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [saved, setSaved] = useState<RaceLog[]>(() => {
    // A log still marked current is one a refresh or crash cut short. It's
    // finished as it stands rather than resumed: the race has moved on.
    const orphan = loadCurrentLog();
    if (orphan) {
      orphan.endedAt ??= new Date().toISOString();
      return archiveLog(orphan);
    }
    return loadSavedLogs();
  });
  const recorder = useRef<RaceRecorder | null>(null);

  useEffect(() => {
    return connectSauce(address, {
      onStatus: (next) => {
        setStatus(next);
        if (next === "connected") setFailed(false);
        if (next === "disconnected") {
          setFailed(true);
          localNetworkPermission().then(setPermission);
        }
      },
      onWatching: (data) => {
        setWatching(data);
        const r = recorder.current;
        if (r) {
          const before = r.log.events.length;
          r.watching(data);
          if (r.log.events.length !== before) setEvents(feed(r.log));
        }
      },
      onGroups: (g) => {
        setGroups(g);
        const r = recorder.current;
        if (r) {
          const before = r.log.events.length;
          r.groups(g);
          if (r.log.events.length !== before) setEvents(feed(r.log));
        }
      },
      onChat: (chat) => {
        const r = recorder.current;
        if (r) {
          r.chat(chat);
          setEvents(feed(r.log));
        }
      },
    });
  }, [address]);

  useEffect(() => {
    if (!recording) return;
    const started = Date.now();
    const tick = setInterval(() => setElapsed(Date.now() - started), 1000);
    const autosave = setInterval(() => {
      if (recorder.current) saveCurrentLog(recorder.current.log);
    }, AUTOSAVE_MS);
    return () => {
      clearInterval(tick);
      clearInterval(autosave);
    };
  }, [recording]);

  const start = () => {
    const r = new RaceRecorder();
    recorder.current = r;
    setEvents(feed(r.log));
    setElapsed(0);
    setRecording(true);
    saveCurrentLog(r.log);
  };

  const stop = () => {
    const r = recorder.current;
    if (!r) return;
    recorder.current = null;
    setRecording(false);
    const log = r.stop();
    setEvents(feed(log));
    setSaved(archiveLog(log));
  };

  const s = watching?.state;
  const ftp = watching?.athlete?.ftp;
  const weight = watching?.athlete?.weight;
  const remaining =
    watching?.remaining == null
      ? "—"
      : watching.remainingMetric === "time"
        ? formatElapsed(Math.max(0, watching.remaining) * 1000)
        : `${(Math.max(0, watching.remaining) / 1000).toFixed(1)} km`;

  return (
    <>
      <section className={styles.card}>
        <div className={styles.connection}>
          <span className={`${styles.dot} ${styles[status]}`} aria-hidden />
          <span className={styles.connectionText}>
            {status === "connected"
              ? `Connected to Sauce at ${address}`
              : failed
                ? `Can't reach Sauce at ${address} - retrying`
                : `Connecting to Sauce at ${address}…`}
          </span>
          <form
            className={styles.addressForm}
            onSubmit={(e) => {
              e.preventDefault();
              const next = addressDraft.trim();
              if (next) setAddress(next);
            }}
          >
            <input
              className={styles.addressInput}
              value={addressDraft}
              onChange={(e) => setAddressDraft(e.target.value)}
              aria-label="Sauce address"
              spellCheck={false}
            />
            <button type="submit" className={styles.secondaryButton} disabled={addressDraft.trim() === address}>
              Connect
            </button>
          </form>
        </div>
        {status !== "connected" && failed && (
          <div className={styles.hint}>
            {permission === "denied" ? (
              <p>
                Chrome is blocking this site from reaching Sauce. Click the site settings icon to the left of the
                address bar, set <strong>Local network access</strong> to <strong>Allow</strong>, then reload.
              </p>
            ) : permission === "prompt" ? (
              <p>
                Chrome needs your permission to let this site reach Sauce. Look for a prompt under the address bar
                asking to access devices on your local network, and allow it. If there isn't one, click the site
                settings icon to the left of the address bar and set <strong>Local network access</strong> to{" "}
                <strong>Allow</strong>, then reload.
              </p>
            ) : (
              <p>
                Check that Sauce is running with its web server on, that this page is open on the same PC, and that{" "}
                <a href={`http://${address}`} target="_blank" rel="noreferrer">
                  {address}
                </a>{" "}
                opens. If Chrome's site settings (the icon left of the address bar) list{" "}
                <strong>Local network access</strong>, set it to <strong>Allow</strong> and reload.
              </p>
            )}
          </div>
        )}
      </section>

      <section className={styles.card}>
        <div className={styles.riderRow}>
          <div>
            <div className={styles.riderLabel}>{watching?.self ? "Riding" : "Watching"}</div>
            <div className={styles.riderName}>{watching ? athleteName(watching) : "Waiting for Zwift…"}</div>
            {watching?.eventPosition ? (
              <div className={styles.riderMeta}>
                {watching.eventPosition} of {watching.eventParticipants ?? "?"}
              </div>
            ) : null}
          </div>
          <div className={styles.recordControls}>
            {recording && <span className={styles.recordingBadge}>● REC {formatElapsed(elapsed)}</span>}
            {recording ? (
              <button type="button" className={styles.stopButton} onClick={stop}>
                Stop and save
              </button>
            ) : (
              <button type="button" className={styles.primaryButton} onClick={start} disabled={status !== "connected"}>
                Start recording
              </button>
            )}
          </div>
        </div>

        <div className={styles.tiles}>
          <StatTile
            value={s?.power != null ? `${s.power} W` : "—"}
            label="Power"
            subValue={s?.power != null && weight ? `${(s.power / weight).toFixed(1)} W/kg` : undefined}
          />
          <StatTile value={s?.heartrate ? `${s.heartrate}` : "—"} label="Heart rate" />
          <StatTile value={s?.cadence ? `${s.cadence}` : "—"} label="Cadence" />
          <StatTile value={s?.speed != null ? `${s.speed.toFixed(1)}` : "—"} label="km/h" />
          <StatTile value={s?.grade != null ? `${(s.grade * 100).toFixed(1)}%` : "—"} label="Gradient" />
          <StatTile value={remaining} label="To go" />
          <StatTile
            value={watching?.wBal != null ? `${(watching.wBal / 1000).toFixed(1)} kJ` : "—"}
            label="W′ balance"
            subValue={ftp ? `FTP ${ftp} W` : undefined}
          />
        </div>
      </section>

      <RadioCard
        mode="commentary"
        recorder={recorder}
        recording={recording}
        apiBase={apiBase}
        needsKey={needsKey}
        ridingSelf={!!watching?.self}
        onLine={() => {
          if (recorder.current) setEvents(feed(recorder.current.log));
        }}
      />

      {tacticsOverlay ? (
        <p className={styles.overlayHint}>
          Tactics runs in its own overlay: open <strong>Ultra Cyclist Tactics</strong> from Sauce's list of windows. It
          works alongside the commentary, and the coach's calls take priority over it.
        </p>
      ) : (
        <RadioCard
          mode="tactics"
          recorder={recorder}
          recording={recording}
          apiBase={apiBase}
          needsKey={needsKey}
          ridingSelf={!!watching?.self}
        />
      )}

      <div className={styles.columns}>
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Groups on the road</h2>
          {groups.length === 0 ? (
            <p className={styles.empty}>No riders nearby yet.</p>
          ) : (
            <table className={styles.groups}>
              <thead>
                <tr>
                  <th>Gap</th>
                  <th>Riders</th>
                  <th>Avg power</th>
                  <th>Speed</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g, i) => (
                  <tr key={g.id ?? i} className={g.watching ? styles.watchedGroup : undefined}>
                    <td>{g.watching ? "—" : `${g.gap != null && g.gap > 0 ? "+" : ""}${g.gap?.toFixed(0) ?? "?"}s`}</td>
                    <td>{g.athletes?.length ?? 0}</td>
                    <td>{g.power != null ? `${Math.round(g.power)} W` : "—"}</td>
                    <td>{g.speed != null ? `${g.speed.toFixed(1)} km/h` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Race log</h2>
          {events.length === 0 ? (
            <p className={styles.empty}>Start recording to log the race.</p>
          ) : (
            <ol className={styles.events}>
              {events
                .slice()
                .reverse()
                .map((e, i) => (
                  <li key={`${e.t}-${i}`} className={styles[`event_${e.kind}`]}>
                    <span className={styles.eventTime}>{formatElapsed(e.t)}</span>
                    <span>{e.text}</span>
                  </li>
                ))}
            </ol>
          )}
        </section>
      </div>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Saved races</h2>
        {saved.length === 0 ? (
          <p className={styles.empty}>Recorded races are kept here, in this browser.</p>
        ) : (
          <ul className={styles.saved}>
            {saved.map((log) => {
              const end = log.endedAt ? Date.parse(log.endedAt) : Date.parse(log.startedAt);
              return (
                <li key={log.id}>
                  <span>
                    <strong>{log.rider?.name ?? "Unknown rider"}</strong>{" "}
                    <span className={styles.savedMeta}>
                      {new Date(log.startedAt).toLocaleString()} · {formatElapsed(end - Date.parse(log.startedAt))} ·{" "}
                      {log.events.length} moments
                    </span>
                  </span>
                  <button type="button" className={styles.secondaryButton} onClick={() => downloadLog(log)}>
                    Download
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
