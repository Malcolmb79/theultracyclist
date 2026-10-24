import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { useStoredState } from "../utils/useStoredState";
import {
  athleteName,
  connectSauce,
  sauceAddressForModPage,
  type FeedStatus,
  type SauceAthleteData,
} from "../components/race/sauceFeed";
import styles from "./Board.module.css";

// The race board: Zwift's rider list on the right of the screen, redone in
// The Ultra Cyclist's look as a Sauce overlay. Same information - position,
// rider, team, country, gap, watts per kilo, power, heart rate, speed - for
// the riders around the one being watched, with a background that can be
// faded right down so Zwift shows through.

const ROW_CHOICES = [10, 15, 20, 25, 30];

interface Country {
  id: number;
  alpha2: string;
  en: string;
}

/**
 * Sauce's own country list and flag images, served by its web server. The
 * UK's home nations use Zwift-only codes, which Sauce maps to the Union Jack.
 */
function useFlags(sauceAddress: string) {
  const [flags, setFlags] = useState<Map<number, { src: string; name: string }>>(new Map());
  useEffect(() => {
    let cancelled = false;
    fetch(`http://${sauceAddress}/shared/deps/data/countries.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Country[]>) : []))
      .then((list) => {
        if (cancelled) return;
        const m = new Map(
          list.map((c) => [c.id, { src: `http://${sauceAddress}/pages/deps/flags/${c.alpha2}.png`, name: c.en }]),
        );
        const uk = m.get(826);
        if (uk) for (const id of [900, 901, 902, 903]) m.set(id, uk);
        setFlags(m);
      })
      .catch(() => {
        // No flags - the board works without them.
      });
    return () => {
      cancelled = true;
    };
  }, [sauceAddress]);
  return flags;
}

function formatGap(gap: number | undefined): string {
  if (gap == null) return "";
  const abs = Math.abs(gap);
  const sign = gap < 0 ? "−" : "+";
  if (abs < 0.5) return "0s";
  if (abs < 60) return `${sign}${Math.round(abs)}s`;
  const m = Math.floor(abs / 60);
  const s = Math.round(abs % 60);
  return `${sign}${m}:${String(s).padStart(2, "0")}`;
}

/** Riders in race order where Zwift gives one, otherwise by gap on the road. */
function order(riders: SauceAthleteData[]): SauceAthleteData[] {
  const inEvent = riders.some((r) => r.eventPosition);
  return riders.slice().sort((a, b) => {
    if (inEvent) {
      const pa = a.eventPosition || Infinity;
      const pb = b.eventPosition || Infinity;
      if (pa !== pb) return pa - pb;
    }
    return (a.gap ?? 0) - (b.gap ?? 0);
  });
}

/** A window of rows centred on the watched rider, as Zwift's list does. */
function around(riders: SauceAthleteData[], rows: number): SauceAthleteData[] {
  const i = riders.findIndex((r) => r.watching);
  if (i < 0 || riders.length <= rows) return riders.slice(0, rows);
  const start = Math.max(0, Math.min(riders.length - rows, i - Math.floor(rows / 2)));
  return riders.slice(start, start + rows);
}

function RaceBoard() {
  const sauceAddress = useMemo(() => sauceAddressForModPage(), []);
  const [status, setStatus] = useState<FeedStatus>("connecting");
  const [watching, setWatching] = useState<SauceAthleteData | null>(null);
  const [nearby, setNearby] = useState<SauceAthleteData[]>([]);
  const [opacity, setOpacity] = useStoredState("board:opacity", 85, (v) =>
    typeof v === "number" && v >= 0 && v <= 100 ? v : null,
  );
  const [rows, setRows] = useStoredState("board:rows", 20, (v) =>
    typeof v === "number" && ROW_CHOICES.includes(v) ? v : null,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const flags = useFlags(sauceAddress);

  useEffect(() => {
    document.documentElement.classList.add(styles.transparent);
    return connectSauce(sauceAddress, {
      onStatus: setStatus,
      onWatching: setWatching,
      onNearby: setNearby,
    });
  }, [sauceAddress]);

  const shown = around(order(nearby), rows);
  const myTeam = watching?.athlete?.team?.trim().toLowerCase();
  const toGo =
    watching?.remaining == null
      ? null
      : watching.remainingMetric === "time"
        ? `${Math.max(0, Math.round(watching.remaining / 60))} min to go`
        : `${(Math.max(0, watching.remaining) / 1000).toFixed(2)} km to finish`;

  return (
    <div className={styles.board} style={{ ["--board-alpha" as string]: String(opacity / 100) }}>
      <header className={styles.header}>
        <span className={`${styles.dot} ${status === "connected" ? styles.on : styles.off}`} aria-hidden />
        <span className={styles.title}>
          {watching?.eventPosition
            ? `Position ${watching.eventPosition} of ${watching.eventParticipants ?? "?"}`
            : watching
              ? athleteName(watching)
              : status === "connected"
                ? "Waiting for Zwift…"
                : "Connecting to Sauce…"}
        </span>
        <button
          type="button"
          className={styles.gear}
          onClick={() => setSettingsOpen((o) => !o)}
          aria-label="Board settings"
          aria-expanded={settingsOpen}
        >
          ⚙
        </button>
      </header>

      {settingsOpen && (
        <div className={styles.settings}>
          <label className={styles.setting}>
            <span>Background</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
              aria-label="Background opacity"
            />
            <span className={styles.settingValue}>{opacity}%</span>
          </label>
          <label className={styles.setting}>
            <span>Riders</span>
            <select value={rows} onChange={(e) => setRows(Number(e.target.value))} aria-label="Riders shown">
              {ROW_CHOICES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <ol className={styles.rows}>
        {shown.map((r) => {
          const a = r.athlete;
          const s = r.state;
          const wkg = s?.power != null && a?.weight ? s.power / a.weight : undefined;
          const flag = a?.countryCode != null ? flags.get(a.countryCode) : undefined;
          const team = a?.team?.trim();
          const teammate = !r.watching && !!myTeam && team?.toLowerCase() === myTeam;
          return (
            <li
              key={r.athleteId}
              className={`${styles.row} ${r.watching ? styles.watched : ""} ${teammate ? styles.teammate : ""}`}
            >
              <span className={styles.pos}>{r.eventPosition || ""}</span>
              <span className={styles.who}>
                <span className={styles.nameLine}>
                  {flag && <img className={styles.flag} src={flag.src} alt={flag.name} title={flag.name} />}
                  <span className={styles.name}>{athleteName(r)}</span>
                  {team && <span className={styles.team}>{team}</span>}
                </span>
                <span className={styles.stats}>
                  {s?.speed != null && <span>{Math.round(s.speed)} km/h</span>}
                  {s?.power != null && <span>{Math.round(s.power)} W</span>}
                  {s?.heartrate ? <span className={styles.hr}>{s.heartrate} ♥</span> : null}
                  {!r.watching && r.gap != null && <span className={styles.gap}>{formatGap(r.gap)}</span>}
                </span>
              </span>
              <span className={styles.wkg}>{wkg != null ? wkg.toFixed(1) : "–"}</span>
            </li>
          );
        })}
        {shown.length === 0 && <li className={styles.empty}>No riders nearby yet.</li>}
      </ol>

      {toGo && <footer className={styles.footer}>{toGo}</footer>}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RaceBoard />
  </StrictMode>,
);
