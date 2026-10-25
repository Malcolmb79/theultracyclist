import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { athleteName, cleanName, type SauceAthleteData, type SauceGroup } from "../components/race/sauceFeed";
import { OverlayShell, useSettings, type SettingDef } from "./overlay";
import { useSauce } from "./useSauce";
import shell from "./Overlay.module.css";
import styles from "./Groups.module.css";

// The groups on the road either side of the watched rider's. The Ultra
// Cyclist's own view is a race-situation graphic: the road running left to
// right with the race heading right, each group placed along it by its time
// gap and drawn as long as it's strung out, the gaps between them, who's in
// each group and how hard it's riding. Zwift's row of bubbles is kept as
// the other style.

const DEFAULTS = {
  opacity: 70,
  style: "road",
  ahead: 3,
  behind: 2,
  gap: true,
  names: true,
  riders: true,
  wkg: true,
  power: false,
  speed: false,
  spacing: "gap",
};
const DEFS: SettingDef[] = [
  { key: "style", label: "Style", type: "select", options: [{ value: "road", label: "Road" }, { value: "bubbles", label: "Bubbles" }] },
  { key: "ahead", label: "Groups ahead", type: "select", options: [0, 1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) })) },
  { key: "behind", label: "Groups behind", type: "select", options: [0, 1, 2, 3, 4].map((n) => ({ value: n, label: String(n) })) },
  { key: "gap", label: "Gaps", type: "toggle" },
  { key: "names", label: "Riders' names", type: "toggle" },
  { key: "riders", label: "Number of riders", type: "toggle" },
  { key: "wkg", label: "Watts per kilo", type: "toggle" },
  { key: "power", label: "Average power", type: "toggle" },
  { key: "speed", label: "Speed", type: "toggle" },
  {
    key: "spacing",
    label: "Road spacing",
    type: "select",
    options: [
      { value: "gap", label: "By time gap" },
      { value: "even", label: "Evenly" },
    ],
  },
];

function gapText(sec: number | undefined): string {
  if (sec == null) return "";
  const abs = Math.abs(sec);
  return abs < 60 ? `${Math.round(abs)}s` : `${Math.floor(abs / 60)}:${String(Math.round(abs % 60)).padStart(2, "0")}`;
}

/** A group's best-placed riders, by race position or, outside a race, by watts per kilo. */
function leaders(g: SauceGroup, n: number): SauceAthleteData[] {
  return (g.athletes ?? [])
    .slice()
    .sort((a, b) =>
      a.eventPosition && b.eventPosition
        ? a.eventPosition - b.eventPosition
        : (b.state?.power ?? 0) / (b.athlete?.weight || 75) - (a.state?.power ?? 0) / (a.athlete?.weight || 75),
    )
    .slice(0, n);
}

function surname(a: SauceAthleteData): string {
  return cleanName(a.athlete?.lastName) || athleteName(a);
}

type Settings = typeof DEFAULTS;

function GroupsOverlay() {
  const [settings, set] = useSettings("groups", DEFAULTS);
  const { groups, status } = useSauce({ groups: true });
  const i = groups.findIndex((g) => g.watching);
  const shown = i < 0 ? [] : groups.slice(Math.max(0, i - settings.ahead), i + 1 + settings.behind);
  const empty = shown.length === 0 && (
    <span className={`${shell.panel} ${styles.empty}`}>{status === "connected" ? "No groups yet" : "Connecting…"}</span>
  );

  return (
    <OverlayShell title="Groups" settings={settings} setSetting={set} defs={DEFS}>
      {empty || (settings.style === "bubbles" ? <Bubbles groups={shown} settings={settings} /> : <Road groups={shown} settings={settings} />)}
    </OverlayShell>
  );
}

/** How a group's numbers read, per the settings. */
function Stats({ g, settings }: { g: SauceGroup; settings: Settings }) {
  const wkg = g.power && g.weight ? g.power / g.weight : undefined;
  return (
    <>
      {settings.wkg && wkg != null && <span>{wkg.toFixed(1)} W/kg</span>}
      {settings.power && g.power != null && <span>{Math.round(g.power)} W</span>}
      {settings.speed && g.speed != null && <span>{Math.round(g.speed)} km/h</span>}
    </>
  );
}

/**
 * The road: groups placed by their time gap to the rider's group, on a
 * compressed scale so a group a minute up still fits beside one five
 * seconds up - or evenly spaced, if that reads better.
 */
function Road({ groups, settings }: { groups: SauceGroup[]; settings: Settings }) {
  const gaps = groups.map((g) => g.gap ?? 0);
  // Race order runs right: the group furthest ahead (most negative gap) on the right.
  const squash = (gap: number) => Math.sign(gap) * Math.log1p(Math.abs(gap) / 4);
  // Groups come furthest ahead first, so evenly spaced they count up from the front.
  const values = settings.spacing === "even" ? groups.map((_, k) => k) : gaps.map(squash);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pos = (k: number) => (hi === lo ? 50 : 8 + ((hi - values[k]) / (hi - lo)) * 84);
  const hasLeader = groups.some((g) => g.athletes?.some((a) => a.eventPosition === 1));

  return (
    <div className={styles.road}>
      <div className={styles.tarmac} aria-hidden>
        <span className={styles.direction}>▶</span>
      </div>
      {groups.map((g, k) => {
        const size = g.athletes?.length ?? 0;
        const names = settings.names ? leaders(g, size > 3 ? 2 : 3).map(surname) : [];
        const more = settings.names && size > names.length ? size - names.length : 0;
        // Strung out groups draw longer: a few seconds of length is a long capsule.
        const length = Math.min(70, 18 + (g.lengthTime ?? 0) * 6 + Math.log2(size + 1) * 4);
        const leading = hasLeader && g.athletes?.some((a) => a.eventPosition === 1);
        return (
          <div key={g.id ?? k} className={`${styles.spot} ${g.watching ? styles.mine : ""}`} style={{ left: `${pos(k)}%` }}>
            <div className={styles.above}>
              {leading && <span className={styles.leader}>Leader</span>}
              {settings.names && names.length > 0 && (
                <span className={styles.names}>
                  {names.join(", ")}
                  {more > 0 && <em> +{more}</em>}
                </span>
              )}
            </div>
            <span className={styles.capsule} style={{ width: length }}>
              {settings.riders && size}
            </span>
            <div className={styles.below}>
              <Stats g={g} settings={settings} />
            </div>
          </div>
        );
      })}
      {settings.gap &&
        groups.slice(1).map((g, k) => {
          // Between each group and the one ahead of it.
          const split = Math.abs((g.gap ?? 0) - (groups[k].gap ?? 0));
          return (
            <span key={`gap-${k}`} className={styles.gapLabel} style={{ left: `${(pos(k) + pos(k + 1)) / 2}%` }}>
              {gapText(split)}
            </span>
          );
        })}
    </div>
  );
}

/** Zwift's row of group bubbles. */
function Bubbles({ groups, settings }: { groups: SauceGroup[]; settings: Settings }) {
  return (
    <div className={styles.row}>
      {groups.map((g, k) => {
        const size = g.athletes?.length ?? 0;
        return (
          <div key={g.id ?? k} className={`${styles.group} ${g.watching ? styles.mine : ""}`}>
            {k > 0 && <span className={styles.link} aria-hidden />}
            <span className={styles.bubble} style={{ ["--size" as string]: String(Math.min(1, Math.log2(size + 1) / 5)) }}>
              {settings.riders ? size : ""}
            </span>
            <span className={styles.meta}>
              {settings.gap && !g.watching && <b>{`${(g.gap ?? 0) < 0 ? "−" : "+"}${gapText(g.gap)}`}</b>}
              {settings.names && <span className={styles.bubbleNames}>{leaders(g, 2).map(surname).join(", ")}</span>}
              <Stats g={g} settings={settings} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <GroupsOverlay />
  </StrictMode>,
);
