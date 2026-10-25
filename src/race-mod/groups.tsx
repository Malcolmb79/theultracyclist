import { StrictMode, useEffect, useRef, useState } from "react";
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
  merge: true,
  labels: "room",
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
    label: "Spacing",
    type: "select",
    options: [
      { value: "gap", label: "By time gap" },
      { value: "even", label: "Evenly" },
    ],
  },
  { key: "merge", label: "Bubbles: merge close groups", type: "toggle" },
  {
    key: "labels",
    label: "Bubbles: labels",
    type: "select",
    options: [
      { value: "room", label: "Where there's room" },
      { value: "all", label: "All" },
      { value: "mine", label: "My group only" },
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
 * Where each group sits across the window, as a percentage from the left,
 * with the race heading right. By time gap the scale is compressed, so a
 * group a minute up still fits beside one five seconds up.
 */
function positions(groups: SauceGroup[], spacing: string): (k: number) => number {
  const squash = (gap: number) => Math.sign(gap) * Math.log1p(Math.abs(gap) / 4);
  // Groups come furthest ahead first, so evenly spaced they count up from the front.
  const values = spacing === "even" ? groups.map((_, k) => k) : groups.map((g) => squash(g.gap ?? 0));
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return (k) => (hi === lo ? 50 : 8 + ((hi - values[k]) / (hi - lo)) * 84);
}

/**
 * The road: groups placed by their time gap to the rider's group, on a
 * compressed scale so a group a minute up still fits beside one five
 * seconds up - or evenly spaced, if that reads better.
 */
function Road({ groups, settings }: { groups: SauceGroup[]; settings: Settings }) {
  const pos = positions(groups, settings.spacing);
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

/** A bubble: one group, or close groups drawn as one. */
interface Bubble {
  key: string;
  groups: SauceGroup[];
  x: number;
  watching: boolean;
}

/** Bubbles whose centres would be closer than this merge into one. */
const MERGE_PX = 36;
/** And no two bubbles are drawn closer than this. */
const MIN_PX = 54;
/** Roughly how wide each kind of label is, to tell whether it fits. */
const LABEL_PX = { full: 100, gap: 44 };

function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/**
 * Where the bubbles go, in pixels: placed by gap like the road, close groups
 * merged (never the rider's own), then nudged apart so none overlap -
 * squeezed together if there are too many for the window.
 */
function layout(groups: SauceGroup[], settings: Settings, width: number): Bubble[] {
  const pct = positions(groups, settings.spacing);
  const bubbles: Bubble[] = [];
  groups.forEach((g, k) => {
    const x = (pct(k) / 100) * width;
    const last = bubbles[bubbles.length - 1];
    if (settings.merge && last && !last.watching && !g.watching && Math.abs(last.x - x) < MERGE_PX) {
      last.groups.push(g);
      // Centred between the groups it's made of.
      last.x = last.groups.reduce((sum, _, j) => sum + (pct(k - last.groups.length + 1 + j) / 100) * width, 0) / last.groups.length;
    } else {
      bubbles.push({ key: String(g.id ?? k), groups: [g], x, watching: !!g.watching });
    }
  });
  // Left to right, then spread: push right, then back from the right edge.
  const xs = bubbles.map((b) => b.x).reverse();
  const gapPx = Math.min(MIN_PX, xs.length > 1 ? (width - 40) / (xs.length - 1) : MIN_PX);
  for (let i = 1; i < xs.length; i++) xs[i] = Math.max(xs[i], xs[i - 1] + gapPx);
  xs[xs.length - 1] = Math.min(xs[xs.length - 1], width - 20);
  for (let i = xs.length - 2; i >= 0; i--) xs[i] = Math.min(xs[i], xs[i + 1] - gapPx);
  xs[0] = Math.max(xs[0], 20);
  for (let i = 1; i < xs.length; i++) xs[i] = Math.max(xs[i], xs[i - 1] + gapPx);
  xs.reverse().forEach((x, i) => (bubbles[i].x = x));
  return bubbles;
}

/** A merged bubble's numbers: the groups' riders and effort taken together. */
function combine(groups: SauceGroup[]): SauceGroup {
  if (groups.length === 1) return groups[0];
  const n = (g: SauceGroup) => g.athletes?.length || 1;
  const avg = (f: (g: SauceGroup) => number | null | undefined) => {
    const known = groups.filter((g) => f(g) != null);
    return known.length ? known.reduce((sum, g) => sum + (f(g) ?? 0) * n(g), 0) / known.reduce((sum, g) => sum + n(g), 0) : undefined;
  };
  return {
    athletes: groups.flatMap((g) => g.athletes ?? []),
    gap: groups[0].gap,
    power: avg((g) => g.power),
    weight: avg((g) => g.weight),
    speed: avg((g) => g.speed),
  };
}

function gapRange(groups: SauceGroup[]): string {
  const first = groups[0].gap ?? 0;
  const last = groups[groups.length - 1].gap ?? 0;
  const sign = (first + last) / 2 < 0 ? "−" : "+";
  const a = gapText(Math.min(Math.abs(first), Math.abs(last)));
  const b = gapText(Math.max(Math.abs(first), Math.abs(last)));
  // "+8–9s" rather than "+8s–9s".
  return a === b ? `${sign}${a}` : `${sign}${a.replace(/s$/, "")}–${b}`;
}

/**
 * Which bubbles get which label. The rider's group and its neighbours are
 * labelled first, then outwards; a label that would run into one already
 * placed drops to just the gap, then to nothing.
 */
function labelling(bubbles: Bubble[], mode: string): ("full" | "gap" | "none")[] {
  const out = bubbles.map((): "full" | "gap" | "none" => (mode === "all" ? "full" : "none"));
  const mine = bubbles.findIndex((b) => b.watching);
  if (mode === "all") return out;
  if (mode === "mine") {
    if (mine >= 0) out[mine] = "full";
    return out;
  }
  const order = bubbles.map((_, i) => i).sort((a, b) => Math.abs(a - mine) - Math.abs(b - mine));
  const taken: [number, number][] = [];
  const fits = (x: number, w: number) => taken.every(([l, r]) => x + w / 2 + 6 <= l || x - w / 2 - 6 >= r);
  for (const i of order) {
    const x = bubbles[i].x;
    for (const kind of ["full", "gap"] as const) {
      // The rider's own bubble has no gap to show, so it's names or nothing.
      if (kind === "gap" && bubbles[i].watching) continue;
      if (fits(x, LABEL_PX[kind])) {
        out[i] = kind;
        taken.push([x - LABEL_PX[kind] / 2, x + LABEL_PX[kind] / 2]);
        break;
      }
    }
  }
  return out;
}

/** Zwift's bubbles, placed along a line by their gaps like the road. */
function Bubbles({ groups, settings }: { groups: SauceGroup[]; settings: Settings }) {
  const [ref, width] = useWidth();
  const bubbles = layout(groups, settings, width);
  const labels = labelling(bubbles, settings.labels);
  return (
    <div ref={ref} className={styles.line}>
      {bubbles.slice(1).map((b, k) => (
        // A link from each bubble to the one ahead, stretching as the gap does.
        <span key={`link-${b.key}`} className={styles.link} style={{ left: b.x, width: bubbles[k].x - b.x }} aria-hidden />
      ))}
      {bubbles.map((b, k) => {
        const g = combine(b.groups);
        const size = g.athletes?.length ?? 0;
        const label = labels[k];
        return (
          <div
            key={b.key}
            className={`${styles.group} ${b.watching ? styles.mine : ""} ${b.groups.length > 1 ? styles.merged : ""}`}
            style={{ left: b.x }}
            title={b.groups.length > 1 ? `${b.groups.length} groups: ${b.groups.map((x) => x.athletes?.length ?? 0).join(" + ")} riders` : undefined}
          >
            <span className={styles.bubble} style={{ ["--size" as string]: String(Math.min(1, Math.log2(size + 1) / 5)) }}>
              {settings.riders ? size : ""}
            </span>
            {label !== "none" && (
              <span className={styles.meta}>
                {settings.gap && !b.watching && <b>{gapRange(b.groups)}</b>}
                {label === "full" && settings.names && <span className={styles.bubbleNames}>{leaders(g, 2).map(surname).join(", ")}</span>}
                {label === "full" && <Stats g={g} settings={settings} />}
              </span>
            )}
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
