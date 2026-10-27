import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { athleteName, cleanName, type SauceAthleteData, type SauceGroup } from "../components/race/sauceFeed";
import { sameRaceGroups } from "../components/race/sameRace";
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
  who: "all",
  category: true,
  ahead: 3,
  behind: 2,
  gap: true,
  names: true,
  riders: true,
  wkg: true,
  power: false,
  maxWkg: false,
  maxPower: false,
  ftpPct: false,
  np: false,
  wbal: false,
  heartrate: false,
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
  {
    key: "who",
    label: "Show",
    type: "select",
    options: [
      { value: "all", label: "Groups ahead and behind" },
      { value: "group", label: "My group only" },
    ],
  },
  { key: "category", label: "Only my category", type: "toggle" },
  { key: "ahead", label: "Groups ahead", type: "select", options: [0, 1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) })) },
  { key: "behind", label: "Groups behind", type: "select", options: [0, 1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) })) },
  { key: "gap", label: "Gaps", type: "toggle" },
  { key: "names", label: "Riders' names", type: "toggle" },
  { key: "riders", label: "Number of riders", type: "toggle" },
  { key: "wkg", label: "Average W/kg", type: "toggle" },
  { key: "power", label: "Average watts", type: "toggle" },
  { key: "maxWkg", label: "Hardest rider's W/kg", type: "toggle" },
  { key: "maxPower", label: "Hardest rider's watts", type: "toggle" },
  { key: "ftpPct", label: "Average % of FTP", type: "toggle" },
  { key: "np", label: "Average normalised power", type: "toggle" },
  { key: "wbal", label: "Average W′ left", type: "toggle" },
  { key: "heartrate", label: "Average heart rate", type: "toggle" },
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
/** The mean of what's known for a group's riders. */
function mean(values: (number | null | undefined)[]): number | undefined {
  const known = values.filter((v): v is number => v != null && Number.isFinite(v));
  return known.length ? known.reduce((a, b) => a + b, 0) / known.length : undefined;
}

function Stats({ g, settings }: { g: SauceGroup; settings: Settings }) {
  const riders = g.athletes ?? [];
  const wkg = g.power && g.weight ? g.power / g.weight : undefined;
  // The hardest-working rider right now, by watts per kilo.
  const each = riders
    .map((a) => ({ w: a.state?.power, kg: a.athlete?.weight }))
    .filter((r): r is { w: number; kg: number | undefined } => r.w != null);
  const maxPower = each.length ? Math.max(...each.map((r) => r.w)) : undefined;
  const withKg = each.filter((r) => r.kg);
  const maxWkg = withKg.length ? Math.max(...withKg.map((r) => r.w / r.kg!)) : undefined;
  const ftpPct = mean(riders.map((a) => (a.state?.power != null && a.athlete?.ftp ? a.state.power / a.athlete.ftp : undefined)));
  const np = mean(riders.map((a) => a.stats?.power?.np));
  const wbal = mean(riders.map((a) => (a.wBal != null && a.athlete?.wPrime ? a.wBal / a.athlete.wPrime : undefined)));
  const hr = mean(riders.map((a) => a.state?.heartrate || undefined)) ?? (g.heartrate || undefined);
  return (
    <>
      {settings.wkg && wkg != null && <span>{wkg.toFixed(1)} W/kg</span>}
      {settings.power && g.power != null && <span>{Math.round(g.power)} W</span>}
      {settings.maxWkg && maxWkg != null && <span>max {maxWkg.toFixed(1)} W/kg</span>}
      {settings.maxPower && maxPower != null && <span>max {Math.round(maxPower)} W</span>}
      {settings.ftpPct && ftpPct != null && <span>{Math.round(ftpPct * 100)}% FTP</span>}
      {settings.np && np != null && <span>NP {Math.round(np)} W</span>}
      {settings.wbal && wbal != null && <span>W′ {Math.round(Math.max(0, Math.min(1, wbal)) * 100)}%</span>}
      {settings.heartrate && hr != null && <span>{Math.round(hr)} bpm</span>}
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

/** A group no longer than this, in seconds front to back, is riding together. */
const TOGETHER_S = 1;

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

/**
 * Where the watched rider sits in their group, front (0) to back (1), by
 * the riders' gaps to them; undefined when the group is too tight to tell.
 */
function placeInGroup(g: SauceGroup, watchingId: number | undefined): number | undefined {
  const riders = g.athletes ?? [];
  const me = riders.find((a) => a.watching || a.athleteId === watchingId);
  if (!me || riders.length < 2) return undefined;
  const gaps = riders.map((a) => a.gap ?? 0);
  const front = Math.min(...gaps);
  const back = Math.max(...gaps);
  if (back - front < 0.2) return undefined;
  return ((me.gap ?? 0) - front) / (back - front);
}

function GroupsView({ groups, mine, settings, watchingId }: { groups: SauceGroup[]; mine: number; settings: Settings; watchingId?: number }) {
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
        // A circle while the group rides together; strung out, it stretches
        // into a capsule as long as the group - longer for a bigger group -
        // so a group about to split shows it.
        const thick = (vertical ? (isMine ? 28 : 22) : isMine ? 26 : 20) * scale;
        const stretch = Math.max(0, (g.lengthTime ?? 0) - TOGETHER_S) * (6 + Math.log2(size + 1) * 2) * scale;
        // Clear of the gap label halfway to the next mark.
        const clear = room - (vertical ? 40 : 76) * scale;
        const capsule = Math.max(thick, Math.min(thick + stretch, 130 * scale, clear));
        const nameCount = label === "full" ? (size > 3 ? 2 : 3) : 1;
        const names = settings.names && label !== "none" ? leaders(g, nameCount).map(surname) : [];
        const more = label === "full" && size > names.length ? size - names.length : 0;
        const leading = hasLeader && g.athletes?.some((a) => a.eventPosition === 1);
        // A faint line across the rider's own marker at their place in it:
        // across the front if they're on the front, the back if at the back.
        const myPlace = isMine ? placeInGroup(g, watchingId) : undefined;
        const meLine =
          myPlace != null ? (
            <span
              className={styles.meLine}
              aria-hidden
              style={vertical ? { top: `${(12 + myPlace * 76).toFixed(1)}%` } : { left: `${(88 - myPlace * 76).toFixed(1)}%` }}
            />
          ) : null;
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
                {meLine}
              </span>
            ) : (
              <span className={styles.bubble} style={{ ["--size" as string]: String(Math.min(1, Math.log2(size + 1) / 5)) }}>
                {settings.riders ? size : ""}
                {meLine}
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
  const { groups: all, status, watching } = useSauce({ groups: true });
  // In an event, only the rider's own category if chosen.
  const groups = sameRaceGroups(all, settings.category ? watching?.state?.eventSubgroupId || undefined : undefined);
  const i = groups.findIndex((g) => g.watching);
  const groupOnly = settings.who === "group";
  const from = groupOnly ? i : Math.max(0, i - settings.ahead);
  const shown = i < 0 ? [] : groups.slice(from, i + 1 + (groupOnly ? 0 : settings.behind));

  return (
    <OverlayShell title="Groups" settings={settings} setSetting={set} defs={DEFS}>
      {shown.length === 0 ? (
        <span className={`${shell.panel} ${styles.empty}`}>{status === "connected" ? "No groups yet" : "Connecting…"}</span>
      ) : (
        <GroupsView groups={shown} mine={i - from} settings={settings} watchingId={watching?.athleteId} />
      )}
    </OverlayShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <GroupsOverlay />
  </StrictMode>,
);
