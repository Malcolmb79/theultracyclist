import { StrictMode, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { athleteName, type SauceAthleteData } from "../components/race/sauceFeed";
import { inRace } from "../components/race/sameRace";
import { OverlayShell, useSettings, type SettingDef } from "./overlay";
import { useSauce } from "./useSauce";
import { hrColour } from "./zones";
import { powerUpLeft } from "./powerUpTimers";
import { useFlags } from "./flags";
import { powerUp } from "../components/race/powerUps";
import PowerUpIcon from "./PowerUpIcon";
import styles from "./Board.module.css";

// The race board: Zwift's rider list on the right of the screen, redone in
// The Ultra Cyclist's look as a Sauce overlay. Same information - position,
// rider, team, country, gap, watts per kilo, power, heart rate, speed - for
// the riders around the one being watched, with a background that can be
// faded right down so Zwift shows through.

const ROW_CHOICES = [10, 15, 20, 25, 30];
/** Sauce's own default W′ when a rider's profile doesn't set one. */
const DEFAULT_W_PRIME = 20_000;

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
/**
 * Each rider's place in the race. Sauce gives it where it knows it - often
 * only for the rider being followed - so the rest are counted from there,
 * by who's ahead on the road (distance covered in the event, else the gap):
 * estimates, since riders out of sight can't be counted.
 */
function placesOf(riders: SauceAthleteData[], watched: SauceAthleteData | null): Map<number, { pos: number; est: boolean }> {
  const places = new Map<number, { pos: number; est: boolean }>();
  for (const r of riders) if (r.eventPosition) places.set(r.athleteId, { pos: r.eventPosition, est: false });
  const anchor = watched?.eventPosition;
  if (!anchor) return places;
  const dist = (r: SauceAthleteData) => (r.state as { eventDistance?: number } | null | undefined)?.eventDistance;
  const byRoad = riders
    .slice()
    .sort((a, b) => (dist(a) != null && dist(b) != null ? dist(b)! - dist(a)! : (a.gap ?? 0) - (b.gap ?? 0)));
  const me = byRoad.findIndex((r) => r.athleteId === watched!.athleteId || r.watching);
  if (me < 0) return places;
  // Counting out from the followed rider, in road order: the riders out of
  // sight ahead of them account for the places above. When more are ahead
  // on the road than their place allows - bunched together, at the start -
  // the order is a matter of centimetres: everyone is numbered in road
  // order from the front, skipping the followed rider's own place. Either
  // way every place is different, and in road order.
  const outOfSight = anchor - 1 - me;
  let next = outOfSight >= 0 ? outOfSight + 1 : 1;
  byRoad.forEach((r, i) => {
    if (i === me) return;
    if (outOfSight < 0 && next === anchor) next++;
    if (outOfSight >= 0 && i > me && next === anchor) next++;
    if (!places.has(r.athleteId)) places.set(r.athleteId, { pos: next, est: true });
    next++;
  });
  return places;
}

/** Race order where places are known, otherwise road order (gap). */
function order(riders: SauceAthleteData[], places: Map<number, { pos: number; est: boolean }>): SauceAthleteData[] {
  return riders.slice().sort((a, b) => {
    const pa = places.get(a.athleteId)?.pos;
    const pb = places.get(b.athleteId)?.pos;
    if (pa != null && pb != null && pa !== pb) return pa - pb;
    return (a.gap ?? 0) - (b.gap ?? 0);
  });
}

/** A window of rows centred on the watched rider, as Zwift's list does. */
function around(riders: SauceAthleteData[], rows: number, watchedId?: number): SauceAthleteData[] {
  const i = riders.findIndex((r) => r.watching || r.athleteId === watchedId);
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
  category: true,
  fill: true,
  hideOtherRaces: true,
  ownPlaces: true,
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
  powerUps: true,
  wkgZone: true,
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
  { key: "category", label: "Only my category", type: "toggle" },
  { key: "fill", label: "Fill up with riders nearby", type: "toggle" },
  { key: "hideOtherRaces", label: "Hide other races", type: "toggle" },
  { key: "ownPlaces", label: "Places within my category", type: "toggle" },
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
  { key: "powerUps", label: "Active power-ups", type: "toggle" },
  { key: "wkgZone", label: "W/kg coloured by zone", type: "toggle" },
  { key: "toGo", label: "Distance to finish", type: "toggle" },
];

function RaceBoard() {
  const [settings, set] = useSettings("board", DEFAULTS);
  const groupOnly = settings.who === "group";
  const { address, status, watching, nearby, groups } = useSauce({ nearby: true, groups: groupOnly });
  const flags = useFlags(address);

  // Just the riders in the watched rider's group, when that's what's chosen.
  const mine = groupOnly ? new Set(groups.find((g) => g.watching)?.athletes?.map((a) => a.athleteId)) : null;
  // And, in an event, only the rider's own category if chosen.
  const subgroup = settings.category ? watching?.state?.eventSubgroupId || undefined : undefined;
  const riders = (mine ? nearby.filter((r) => r.watching || mine.has(r.athleteId)) : nearby).filter((r) => inRace(r, subgroup));
  // As many rows as the window has room for (up to the setting), the rider in the middle -
  // so in a short window they're centred rather than cut off the bottom.
  const list = useRef<HTMLOListElement | null>(null);
  const [fit, setFit] = useState(settings.rows);
  useLayoutEffect(() => {
    const measure = () => {
      const el = list.current;
      const items = el ? Array.from(el.children) as HTMLElement[] : [];
      if (!el || !items.length) return;
      const rowH = items.reduce((sum, li) => sum + li.offsetHeight, 0) / items.length;
      // What sits under the list (the distance to the finish) needs its room too.
      let below = 0;
      for (let n = el.nextElementSibling; n; n = n.nextElementSibling) below += (n as HTMLElement).offsetHeight;
      const room = window.innerHeight - el.getBoundingClientRect().top - below;
      const rows = Math.max(3, Math.floor(room / Math.max(1, rowH)));
      setFit((f) => (f === rows ? f : rows));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  });
  // Room to spare (a small group, a small category): filled with the
  // nearest riders ahead and behind - the rider's own race first, then
  // anyone else on the road - shown dimmed, so the board isn't half empty.
  const rows = Math.min(settings.rows, fit);
  const have = new Set(riders.map((r) => r.athleteId));
  const nearest = (xs: SauceAthleteData[]) => xs.slice().sort((a, b) => Math.abs(a.gap ?? Infinity) - Math.abs(b.gap ?? Infinity));
  const extras =
    settings.fill && riders.length < rows
      ? [
          ...nearest(nearby.filter((r) => !have.has(r.athleteId) && inRace(r, subgroup))),
          ...(settings.hideOtherRaces ? [] : nearest(nearby.filter((r) => !have.has(r.athleteId) && !inRace(r, subgroup)))),
        ].slice(0, rows - riders.length)
      : [];
  const extraIds = new Set(extras.map((r) => r.athleteId));
  // Mixed in, they all go in road order: race positions mean nothing across them.
  // Zwift can rank every category of an event together, so a rider from
  // another race up the road takes a place off the front of this one.
  // Within my category: places less the other races' riders ahead.
  const mySubgroup = watching?.state?.eventSubgroupId || undefined;
  const others = settings.ownPlaces && mySubgroup ? nearby.filter((r) => !inRace(r, mySubgroup)) : [];
  const inCategory = (pos: number, gap: number | undefined) =>
    Math.max(1, pos - others.filter((o) => (o.eventPosition ? o.eventPosition < pos : (o.gap ?? 0) < (gap ?? 0))).length);
  const ownRace = nearby.filter((r) => inRace(r, subgroup)).map((r) => (r.eventPosition && others.length ? { ...r, eventPosition: inCategory(r.eventPosition, r.gap) } : r));
  const watchedPlaced = watching?.eventPosition && others.length ? { ...watching, eventPosition: inCategory(watching.eventPosition, 0) } : watching;
  const places = placesOf(ownRace, watchedPlaced);
  const all = extras.length ? [...riders, ...extras].sort((a, b) => (a.gap ?? 0) - (b.gap ?? 0)) : order(riders, places);
  const shown = around(all, rows, watching?.athleteId);
  // Room left of the places for a power-up only while someone listed has one running.
  const puRoom = settings.powerUps && shown.some((r) => r.state?.activePowerUp && powerUp(r.state.activePowerUp));
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
          {watchedPlaced?.eventPosition
            ? watchedPlaced.eventPosition !== watching?.eventPosition
              ? `Position ${watchedPlaced.eventPosition} in category`
              : `Position ${watchedPlaced.eventPosition} of ${watching?.eventParticipants ?? "?"}`
            : watching
              ? athleteName(watching)
              : status === "connected"
                ? "Waiting for Zwift…"
                : "Connecting to Sauce…"}
        </span>
      </header>

      <ol ref={list} className={styles.rows}>
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
              className={`${styles.row} ${puRoom ? styles.withPowerUps : ""} ${r.watching ? styles.watched : ""} ${teammate ? styles.teammate : ""} ${extraIds.has(r.athleteId) ? styles.extra : ""}`}
            >
              <span
                className={`${styles.pos} ${places.get(r.athleteId)?.est ? styles.estimated : ""}`}
                title={places.get(r.athleteId)?.est ? "Estimated from who's ahead on the road" : undefined}
              >
                {/* A power-up running, beside the place - in its own space, so places still line up. */}
                {settings.powerUps && s?.activePowerUp && powerUp(s.activePowerUp) && (
                  <span className={styles.powerUp} title={`${powerUp(s.activePowerUp)!.name}: ${powerUp(s.activePowerUp)!.effect}`}>
                    <PowerUpIcon code={s.activePowerUp} size={20} left={powerUpLeft(r.athleteId, s.activePowerUp)} />
                  </span>
                )}
                <span className={styles.posNum}>{places.get(r.athleteId)?.pos ?? ""}</span>
              </span>
              <span className={styles.who}>
                <span
                  className={`${styles.nameLine} ${wbal != null ? styles.withWbal : ""}`}
                  style={wbal != null ? { ["--wbal" as string]: String(wbal) } : undefined}
                  title={wbal != null && r.wBal != null ? `W′ ${(r.wBal / 1000).toFixed(1)} kJ (${Math.round(wbal * 100)}%)` : undefined}
                >
                  {flag && <img className={styles.flag} src={flag.src} alt={flag.name} title={flag.name} />}
                  <span className={styles.name}>{athleteName(r)}</span>
                  {settings.teams && team && <span className={styles.team}>{team}</span>}
                  {extraIds.has(r.athleteId) && !inRace(r, subgroup) && <span className={styles.otherRace}>other race</span>}
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
                  {settings.heartRate && s?.heartrate ? <span className={styles.hr} style={{ color: hrColour(r, s.heartrate) }}>{s.heartrate} ♥</span> : null}
                  {settings.gaps && !r.watching && r.gap != null && <span className={styles.gap}>{formatGap(r.gap)}</span>}
                </span>
              </span>
              <span
                className={styles.wkg}
                // In the colour of the zone they're riding in, as the % of FTP is - where their FTP is known.
                style={settings.wkgZone && s?.power != null && a?.ftp ? { color: zoneColor((s.power / a.ftp) * 100) } : undefined}
              >
                {wkg != null ? wkg.toFixed(1) : "–"}
              </span>
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
