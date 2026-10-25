import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { athleteName, cleanName, type SauceAthleteData, type SauceGroup } from "../components/race/sauceFeed";
import { OverlayShell, textScale, useSettings, type SettingDef } from "./overlay";
import { useSauce } from "./useSauce";
import shell from "./Overlay.module.css";
import styles from "./Groups.module.css";

// The groups on the road either side of the watched rider's. The rider's
// group is the centre of it all, fixed in the middle and drawn largest, with
// the groups ahead on one side and those behind on the other - to the right
// and left when the view runs across, above and below when it runs up and
// down. Each group is placed by its time gap (on a compressed scale, so a
// group a minute up still fits) or evenly. Close groups can merge into one,
// none are drawn on top of each other, and labels show where they fit,
// nearest the rider first. Two styles: The Ultra Cyclist's road, with groups
// drawn as long as they're strung out and the splits between them, or
// Zwift's bubbles.

const DEFAULTS = {
  opacity: 70,
  style: "road",
  orientation: "horizontal",
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
  {
    key: "orientation",
    label: "Layout",
    type: "select",
    options: [
      { value: "horizontal", label: "Horizontal" },
      { value: "vertical", label: "Vertical" },
    ],
  },
  { key: "ahead", label: "Groups ahead", type: "select", options: [0, 1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) })) },
  { key: "behind", label: "Groups behind", type: "select", options: [0, 1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) })) },
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
  { key: "merge", label: "Merge close groups", type: "toggle" },
  {
    key: "labels",
    label: "Labels",
    type: "select",
    options: [
      { value: "room", label: "Where there's room" },
      { value: "all", label: "All" },
      { value: "mine", label: "My group only" },
    ],
  },
];

type Settings = typeof DEFAULTS;

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

/** One mark on the view: a group, or close groups drawn as one, from the rider's group outwards. */
interface Item {
  key: string;
  groups: SauceGroup[];
  /** Distance from the rider's group along the view, in pixels; ahead and behind both count up from 0. */
  d: number;
  side: "ahead" | "mine" | "behind";
  /** Where it's drawn along the view, in pixels from the left or top. */
  at: number;
}

type Label = "full" | "short" | "none";

function geometry(settings: Settings) {
  const g = BASE_GEOMETRY[settings.orientation === "vertical" ? "vertical" : "horizontal"];
  const k = textScale();
  return { mergePx: g.mergePx * k, minPx: g.minPx * k, edge: g.edge * k, label: { full: g.label.full * k, short: g.label.short * k } };
}

/**
 * Per layout, at normal text size: how close marks may sit, how far a label
 * runs along the view, and the margin at each end. All scale with the text.
 */
const BASE_GEOMETRY = {
  horizontal: { mergePx: 36, minPx: 56, edge: 30, label: { full: 104, short: 50 } },
  vertical: { mergePx: 22, minPx: 34, edge: 26, label: { full: 32, short: 15 } },
};

/** The view's length along its axis, kept up to date as the window is resized. */
function useLength(vertical: boolean): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, vertical ? size.h : size.w];
}

const squash = (gap: number) => Math.log1p(Math.abs(gap) / 4);

/**
 * Where everything goes. The rider's group sits in the middle; each side
 * is laid out outwards from it on its own scale, close groups merged (never
 * the rider's own), then nudged apart so nothing overlaps - squeezed up if
 * there are more than fit.
 */
function layout(groups: SauceGroup[], mine: number, settings: Settings, length: number): Item[] {
  const geo = geometry(settings);
  const centre = length / 2;
  const half = Math.max(40, centre - geo.edge);
  // Outwards from the rider: ahead runs back up the list (the front comes first).
  const sides = {
    ahead: groups.slice(0, mine).reverse(),
    behind: groups.slice(mine + 1),
  };
  const items: Item[] = [{ key: String(groups[mine].id ?? "mine"), groups: [groups[mine]], d: 0, side: "mine", at: centre }];
  for (const side of ["ahead", "behind"] as const) {
    const list = sides[side];
    if (!list.length) continue;
    // A side's own scale, so its furthest group reaches the end - but a lone
    // group a few seconds away isn't flung to the edge.
    const far = Math.max(squash(20), ...list.map((g) => squash(g.gap ?? 0)));
    const step = Math.min(half / list.length, 160);
    const raw = list.map((g, k) => (settings.spacing === "even" ? (k + 1) * step : (squash(g.gap ?? 0) / far) * half));
    const marks: Item[] = [];
    list.forEach((g, k) => {
      const last = marks[marks.length - 1];
      if (settings.merge && last && raw[k] - last.d < geo.mergePx) {
        last.groups.push(g);
        last.d = (last.d * (last.groups.length - 1) + raw[k]) / last.groups.length;
      } else {
        marks.push({ key: String(g.id ?? `${side}-${k}`), groups: [g], d: raw[k], side, at: 0 });
      }
    });
    // Apart from each other and from the rider's group, and inside the window.
    const gap = Math.min(geo.minPx, half / marks.length);
    const ds = marks.map((m) => m.d);
    const spread = () => ds.forEach((_, j) => (ds[j] = Math.max(ds[j], (j ? ds[j - 1] : 0) + gap)));
    spread();
    ds[ds.length - 1] = Math.min(ds[ds.length - 1], half);
    for (let j = ds.length - 2; j >= 0; j--) ds[j] = Math.min(ds[j], ds[j + 1] - gap);
    spread();
    marks.forEach((m, j) => {
      m.d = ds[j];
      // Ahead is to the right across, and up the window when it runs down.
      const sign = (side === "ahead") === (settings.orientation === "vertical") ? -1 : 1;
      m.at = centre + sign * m.d;
      items.push(m);
    });
  }
  return items;
}

/**
 * Which marks get which label. The rider's group first, then outwards in
 * turn either side; a label that would run into one already placed is cut
 * down, then dropped.
 */
function labelling(items: Item[], settings: Settings): Label[] {
  const mode = settings.labels;
  if (mode === "all") return items.map(() => "full");
  if (mode === "mine") return items.map((it) => (it.side === "mine" ? "full" : "none"));
  const geo = geometry(settings);
  const out: Label[] = items.map(() => "none");
  const order = items.map((_, i) => i).sort((a, b) => items[a].d - items[b].d);
  const taken: [number, number][] = [];
  const fits = (at: number, w: number) => taken.every(([l, r]) => at + w / 2 + 4 <= l || at - w / 2 - 4 >= r);
  for (const i of order) {
    for (const kind of ["full", "short"] as const) {
      const w = geo.label[kind];
      if (fits(items[i].at, w)) {
        out[i] = kind;
        taken.push([items[i].at - w / 2, items[i].at + w / 2]);
        break;
      }
    }
  }
  return out;
}

/** A merged mark's numbers: the groups' riders and effort taken together. */
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
    lengthTime: Math.max(...groups.map((g) => g.lengthTime ?? 0)),
  };
}

/** The gap to the rider's group: "+12s", or "+8–9s" for merged groups. */
function gapRange(groups: SauceGroup[]): string {
  const gaps = groups.map((g) => Math.abs(g.gap ?? 0));
  const sign = (groups[0].gap ?? 0) < 0 ? "−" : "+";
  const a = gapText(Math.min(...gaps));
  const b = gapText(Math.max(...gaps));
  return a === b ? `${sign}${a}` : `${sign}${a.replace(/s$/, "")}–${b}`;
}

function GroupsView({ groups, mine, settings }: { groups: SauceGroup[]; mine: number; settings: Settings }) {
  const vertical = settings.orientation === "vertical";
  const road = settings.style !== "bubbles";
  const [ref, length] = useLength(vertical);
  const items = layout(groups, mine, settings, length);
  const labels = labelling(items, settings);
  const sorted = items.map((it, i) => ({ it, label: labels[i] })).sort((a, b) => a.it.at - b.it.at);
  const hasLeader = groups.some((g) => g.athletes?.some((a) => a.eventPosition === 1));
  const scale = textScale();
  const place = (at: number) => (vertical ? { top: at } : { left: at });

  return (
    <div
      ref={ref}
      className={`${styles.view} ${vertical ? styles.vertical : styles.horizontal} ${road ? styles.road : styles.bubbles}`}
    >
      <div className={styles.track} aria-hidden>
        {road && <span className={styles.direction}>{vertical ? "▲" : "▶"}</span>}
      </div>
      {sorted.map(({ it, label }, k) => {
        const g = combine(it.groups);
        const size = g.athletes?.length ?? 0;
        const isMine = it.side === "mine";
        const merged = it.groups.length > 1;
        // Room either side, so a long capsule never runs into its neighbour.
        const room = Math.min(
          k > 0 ? it.at - sorted[k - 1].it.at : Infinity,
          k < sorted.length - 1 ? sorted[k + 1].it.at - it.at : Infinity,
        );
        const capsule = Math.max(20 * scale, Math.min(70 * scale, room - 10, (18 + (g.lengthTime ?? 0) * 6 + Math.log2(size + 1) * 4) * scale));
        const nameCount = label === "full" ? (size > 3 ? 2 : 3) : 1;
        const names = settings.names && label !== "none" ? leaders(g, nameCount).map(surname) : [];
        const more = label === "full" && size > names.length ? size - names.length : 0;
        const leading = hasLeader && g.athletes?.some((a) => a.eventPosition === 1);
        return (
          <div
            key={it.key}
            className={`${styles.spot} ${isMine ? styles.mine : ""} ${merged ? styles.merged : ""}`}
            style={place(it.at)}
            title={merged ? `${it.groups.length} groups: ${it.groups.map((x) => x.athletes?.length ?? 0).join(" + ")} riders` : undefined}
          >
            <div className={styles.above}>
              {leading && label !== "none" && <span className={styles.leader}>Leader</span>}
              {names.length > 0 && (
                <span className={styles.names}>
                  {names.join(", ")}
                  {more > 0 && <em> +{more}</em>}
                </span>
              )}
            </div>
            {road ? (
              <span className={styles.capsule} style={vertical ? { height: capsule } : { width: capsule }}>
                {settings.riders && size}
              </span>
            ) : (
              <span className={styles.bubble} style={{ ["--size" as string]: String(Math.min(1, Math.log2(size + 1) / 5)) }}>
                {settings.riders ? size : ""}
              </span>
            )}
            <div className={styles.below}>
              {!road && settings.gap && !isMine && label !== "none" && <b className={styles.toMe}>{gapRange(it.groups)}</b>}
              {label === "full" && <Stats g={g} settings={settings} />}
            </div>
          </div>
        );
      })}
      {road &&
        settings.gap &&
        sorted.slice(1).map(({ it }, k) => {
          const prev = sorted[k].it;
          // The split between two neighbouring marks, if there's room to say it.
          if (it.at - prev.at < (vertical ? 46 : 72) * scale) return null;
          // Each mark's groups run outwards, so the facing groups are the
          // inner mark's last and the outer mark's first.
          const [inner, outer] = prev.d < it.d ? [prev, it] : [it, prev];
          const split = Math.abs((outer.groups[0].gap ?? 0) - (inner.groups[inner.groups.length - 1].gap ?? 0));
          return (
            <span key={`gap-${it.key}`} className={styles.gapLabel} style={place((prev.at + it.at) / 2)}>
              {gapText(split)}
            </span>
          );
        })}
    </div>
  );
}

function GroupsOverlay() {
  const [settings, set] = useSettings("groups", DEFAULTS);
  const { groups, status } = useSauce({ groups: true });
  const i = groups.findIndex((g) => g.watching);
  const from = Math.max(0, i - settings.ahead);
  const shown = i < 0 ? [] : groups.slice(from, i + 1 + settings.behind);

  return (
    <OverlayShell title="Groups" settings={settings} setSetting={set} defs={DEFS}>
      {shown.length === 0 ? (
        <span className={`${shell.panel} ${styles.empty}`}>{status === "connected" ? "No groups yet" : "Connecting…"}</span>
      ) : (
        <GroupsView groups={shown} mine={i - from} settings={settings} />
      )}
    </OverlayShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <GroupsOverlay />
  </StrictMode>,
);
