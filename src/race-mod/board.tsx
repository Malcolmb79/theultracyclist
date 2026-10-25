import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { athleteName, type SauceAthleteData } from "../components/race/sauceFeed";
import { OverlayShell, useSettings, type SettingDef } from "./overlay";
import { useSauce } from "./useSauce";
import styles from "./Board.module.css";

// The race board: Zwift's rider list on the right of the screen, redone in
// The Ultra Cyclist's look as a Sauce overlay. Same information - position,
// rider, team, country, gap, watts per kilo, power, heart rate, speed - for
// the riders around the one being watched, with a background that can be
// faded right down so Zwift shows through.

const ROW_CHOICES = [10, 15, 20, 25, 30];
/** Sauce's own default W′ when a rider's profile doesn't set one. */
const DEFAULT_W_PRIME = 20_000;

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

/** Zwift's power zone colours, by share of FTP: grey, blue, green, yellow, orange, red. */
function zoneColor(pct: number): string {
  if (pct < 60) return "#b4b9bf";
  if (pct < 76) return "#4aa8ff";
  if (pct < 90) return "#4cd964";
  if (pct < 105) return "#ffd60a";
  if (pct < 119) return "#ff9500";
  return "#ff453a";
}

/**
 * A rider's TSS so far: Sauce's own figure, or worked out the standard way
 * from normalised power, time and FTP when it hasn't sent one.
 */
function tssOf(r: SauceAthleteData): number | undefined {
  const p = r.stats?.power;
  if (p?.tss != null) return p.tss;
  const ftp = r.athlete?.ftp;
  const secs = r.stats?.activeTime ?? r.stats?.elapsedTime;
  if (!p?.np || !ftp || !secs) return undefined;
  const intensity = p.np / ftp;
  return ((secs * p.np * intensity) / (ftp * 3600)) * 100;
}

const DEFAULTS = {
  opacity: 85,
  who: "all",
  rows: 20,
  flags: true,
  teams: true,
  speed: true,
  power: true,
  ftp: true,
  tss: true,
  heartRate: true,
  gaps: true,
  wbal: true,
  toGo: true,
};
const DEFS: SettingDef[] = [
  {
    key: "who",
    label: "Show",
    type: "select",
    options: [
      { value: "all", label: "Everyone nearby" },
      { value: "group", label: "My group only" },
    ],
  },
  { key: "rows", label: "Riders shown", type: "select", options: ROW_CHOICES.map((n) => ({ value: n, label: String(n) })) },
  { key: "flags", label: "Flags", type: "toggle" },
  { key: "teams", label: "Team tags", type: "toggle" },
  { key: "speed", label: "Speed", type: "toggle" },
  { key: "power", label: "Power", type: "toggle" },
  { key: "ftp", label: "% of FTP", type: "toggle" },
  { key: "tss", label: "TSS", type: "toggle" },
  { key: "heartRate", label: "Heart rate", type: "toggle" },
  { key: "gaps", label: "Gaps", type: "toggle" },
  { key: "wbal", label: "W′ balance bar", type: "toggle" },
  { key: "toGo", label: "Distance to finish", type: "toggle" },
];

function RaceBoard() {
  const [settings, set] = useSettings("board", DEFAULTS);
  const groupOnly = settings.who === "group";
  const { address, status, watching, nearby, groups } = useSauce({ nearby: true, groups: groupOnly });
  const flags = useFlags(address);

  // Just the riders in the watched rider's group, when that's what's chosen.
  const mine = groupOnly ? new Set(groups.find((g) => g.watching)?.athletes?.map((a) => a.athleteId)) : null;
  const riders = mine ? nearby.filter((r) => r.watching || mine.has(r.athleteId)) : nearby;
  const shown = around(order(riders), settings.rows);
  const myTeam = watching?.athlete?.team?.trim().toLowerCase();
  const toGo =
    watching?.remaining == null
      ? null
      : watching.remainingMetric === "time"
        ? `${Math.max(0, Math.round(watching.remaining / 60))} min to go`
        : `${(Math.max(0, watching.remaining) / 1000).toFixed(2)} km to finish`;

  return (
    <OverlayShell title="Race board" settings={settings} setSetting={set} defs={DEFS} className={styles.board}>
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
      </header>

      <ol className={styles.rows}>
        {shown.map((r) => {
          const a = r.athlete;
          const s = r.state;
          const wkg = s?.power != null && a?.weight ? s.power / a.weight : undefined;
          // Riders who hide their FTP (or have none set) just go without.
          const tss = settings.tss ? tssOf(r) : undefined;
          const ftpPct = settings.ftp && s?.power != null && a?.ftp ? (s.power / a.ftp) * 100 : undefined;
          const flag = settings.flags && a?.countryCode != null ? flags.get(a.countryCode) : undefined;
          const team = a?.team?.trim();
          const teammate = !r.watching && !!myTeam && team?.toLowerCase() === myTeam;
          // W′ balance as the share of the rider's capacity left: the grey bar
          // behind the name, full when fresh, shrinking as they dig in.
          const wbal =
            settings.wbal && r.wBal != null ? Math.max(0, Math.min(1, r.wBal / (a?.wPrime || DEFAULT_W_PRIME))) : undefined;
          return (
            <li
              key={r.athleteId}
              className={`${styles.row} ${r.watching ? styles.watched : ""} ${teammate ? styles.teammate : ""}`}
            >
              <span className={styles.pos}>{r.eventPosition || ""}</span>
              <span className={styles.who}>
                <span
                  className={`${styles.nameLine} ${wbal != null ? styles.withWbal : ""}`}
                  style={wbal != null ? { ["--wbal" as string]: String(wbal) } : undefined}
                  title={wbal != null && r.wBal != null ? `W′ ${(r.wBal / 1000).toFixed(1)} kJ (${Math.round(wbal * 100)}%)` : undefined}
                >
                  {flag && <img className={styles.flag} src={flag.src} alt={flag.name} title={flag.name} />}
                  <span className={styles.name}>{athleteName(r)}</span>
                  {settings.teams && team && <span className={styles.team}>{team}</span>}
                </span>
                <span className={styles.stats}>
                  {settings.speed && s?.speed != null && <span>{Math.round(s.speed)} km/h</span>}
                  {settings.power && s?.power != null && <span>{Math.round(s.power)} W</span>}
                  {ftpPct != null && (
                    <span className={styles.ftp} style={{ color: zoneColor(ftpPct) }} title={`FTP ${a?.ftp} W`}>
                      {Math.round(ftpPct)}% FTP
                    </span>
                  )}
                  {tss != null && <span className={styles.tss}>{Math.round(tss)} TSS</span>}
                  {settings.heartRate && s?.heartrate ? <span className={styles.hr}>{s.heartrate} ♥</span> : null}
                  {settings.gaps && !r.watching && r.gap != null && <span className={styles.gap}>{formatGap(r.gap)}</span>}
                </span>
              </span>
              <span className={styles.wkg}>{wkg != null ? wkg.toFixed(1) : "–"}</span>
            </li>
          );
        })}
        {shown.length === 0 && <li className={styles.empty}>No riders nearby yet.</li>}
      </ol>

      {settings.toGo && toGo && <footer className={styles.footer}>{toGo}</footer>}
    </OverlayShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RaceBoard />
  </StrictMode>,
);
