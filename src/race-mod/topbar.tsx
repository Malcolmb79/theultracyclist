import { StrictMode, useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { athleteName, type SauceAthleteData } from "../components/race/sauceFeed";
import { loadEventBrief } from "../components/race/eventInfo";
import { OverlayShell, useSettings, type SettingDef } from "./overlay";
import { useSauce } from "./useSauce";
import { colourOf, display } from "./riderFields";
import { STAT_FIELDS, STAT_GROUPS } from "./statFields";
import PowerUpIcon from "./PowerUpIcon";
import { powerUpLeft } from "./powerUpTimers";
import BarPicker, { type BarChoice } from "./BarPicker";
import shell from "./Overlay.module.css";
import styles from "./TopBar.module.css";

// A thin bar across the top of the screen, to use instead of Sauce's own:
// three sections - left, centre and right - each holding whatever's chosen,
// in the order chosen: Zwift's ride numbers, anything Sauce knows about the
// rider, the event's name, the time of day, Ride Ons, a power-up running,
// or your own text. Labelled the way you like, sized by the window's height.

/** What the bar can show besides the numbers. */
const BAR_ITEMS: BarChoice[] = [
  { id: "title", label: "Your text", group: "Bar" },
  { id: "clock", label: "Time of day", group: "Bar" },
  { id: "event", label: "Event name", group: "Bar" },
  { id: "rideOns", label: "Ride Ons", group: "Bar" },
  { id: "powerUp", label: "Power-up running", group: "Bar" },
  { id: "watching", label: "Who you're watching", group: "Bar" },
];
const CHOICES: BarChoice[] = [...BAR_ITEMS, ...STAT_FIELDS.map((f) => ({ id: f.id, label: f.label, group: f.group as string }))];
const GROUPS = ["Bar", ...STAT_GROUPS];
const fieldById = new Map(STAT_FIELDS.map((f) => [f.id, f]));

/** Names on the bar, shorter than the menu's where that reads better. */
const BAR_NAMES: Record<string, string> = {
  energy: "Energy",
  speedAvg: "Speed (avg)",
  toGo: "Finish",
  timeToGo: "Finish",
  rideOns: "Ride Ons",
  hr: "HR",
  power: "Power",
  powerWkg: "W/kg",
  cadence: "Cadence",
  draft: "Draft",
};
/** Units where the short heading isn't one. */
const BAR_UNITS: Record<string, string> = { toGo: "km", timeToGo: "", time: "" };
/** The unit after a number - from its short heading, with the qualifier taken off ("Avg km/h" is km/h). */
function unitOf(short: string): string {
  const u = short.replace(/^(avg|1min|max|lap|last lap|work|follow|solo|saved|np)\s+/i, "");
  if (u.includes("♥")) return "bpm";
  return /^(km\/h|w|w\/kg|kj|rpm|m|km|%|kg|bpm)$/i.test(u) ? u : "";
}

const DEFAULTS = {
  opacity: 85,
  left: "title,rideOns,energy,speedAvg",
  centre: "event",
  right: "toGo,clock",
  title: "The Ultra Cyclist",
  labels: "full",
  colours: true,
  dividers: true,
  clock24: true,
};
const DEFS: SettingDef[] = [
  { key: "title", label: "Your text", type: "text", placeholder: "Shown where 'Your text' is placed" },
  {
    key: "labels",
    label: "Labels",
    type: "select",
    options: [
      { value: "full", label: "Name: value unit (like Sauce)" },
      { value: "unit", label: "Value and unit only" },
      { value: "none", label: "Values only" },
    ],
  },
  { key: "colours", label: "Colour by zone (power, heart rate…)", type: "toggle" },
  { key: "dividers", label: "Dividers between items", type: "toggle" },
  { key: "clock24", label: "24-hour clock", type: "toggle" },
];

interface Shown {
  name?: string;
  value: ReactNode;
  unit?: string;
  colour?: string;
}

function TopBarOverlay() {
  const [settings, set] = useSettings("topbar", DEFAULTS);
  const { address, watching, chat } = useSauce({ chat: true });
  const s = watching?.state;

  // The time of day, to the second.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // The event's name, while in one.
  const subgroup = s?.eventSubgroupId || undefined;
  const [eventName, setEventName] = useState<string>();
  useEffect(() => {
    setEventName(undefined);
    if (!subgroup) return;
    void loadEventBrief(address, subgroup)
      .then((b) => setEventName(b?.name))
      .catch(() => undefined);
  }, [address, subgroup]);

  // Ride Ons given you since the bar opened (Zwift's own count when Sauce has it).
  const seen = useRef(new Set<number>());
  const [rideOns, setRideOns] = useState(0);
  useEffect(() => {
    let n = 0;
    for (const c of chat) if (c.kind === "rideon" && !seen.current.has(c.id)) (seen.current.add(c.id), n++);
    if (n) setRideOns((x) => x + n);
  }, [chat]);
  const zwiftRideOns = (s as { rideons?: number } | null | undefined)?.rideons;

  const item = (id: string): Shown | null => {
    switch (id) {
      case "title":
        return settings.title ? { value: String(settings.title) } : null;
      case "clock":
        return {
          value: now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: !settings.clock24 }),
        };
      case "event":
        return eventName ? { value: eventName } : null;
      case "rideOns":
        return { name: "Ride Ons", value: zwiftRideOns ?? rideOns };
      case "powerUp":
        return s?.activePowerUp && watching
          ? { value: <PowerUpIcon code={s.activePowerUp} size={20} left={powerUpLeft(watching.athleteId, s.activePowerUp)} /> }
          : null;
      case "watching":
        return watching && watching.self === false ? { name: "Watching", value: athleteName(watching) } : null;
    }
    const f = fieldById.get(id);
    if (!f) return null;
    const r = watching as SauceAthleteData | null;
    return {
      name: BAR_NAMES[f.id] ?? f.label.replace(/\s*\(.*\)$/, ""),
      value: r ? display(f, r) : "–",
      unit: BAR_UNITS[f.id] ?? f.unit ?? unitOf(f.short),
      colour: settings.colours && r ? colourOf(f, r) : undefined,
    };
  };

  const section = (ids: string, cls: string) => {
    const shown = String(ids)
      .split(",")
      .filter(Boolean)
      .map((id) => ({ id, x: item(id) }))
      .filter((e): e is { id: string; x: Shown } => !!e.x);
    return (
      <div className={`${styles.section} ${cls}`}>
        {shown.map(({ id, x }, i) => (
          <span key={id} className={`${styles.item} ${settings.dividers && i ? styles.divided : ""} ${id === "title" ? styles.title : ""}`}>
            {settings.labels === "full" && x.name && <span className={styles.name}>{x.name}:</span>}
            <span className={styles.value} style={{ color: x.colour }}>
              {x.value}
            </span>
            {settings.labels !== "none" && x.unit && <span className={styles.unit}>{x.unit}</span>}
          </span>
        ))}
      </div>
    );
  };

  return (
    <OverlayShell
      title="Top bar"
      settings={settings}
      setSetting={set}
      defs={DEFS}
      menuWidth={720}
      extraRows={14}
      extraSettings={
        <BarPicker
          choices={CHOICES}
          groups={GROUPS}
          sections={[
            { key: "left", title: "Left", value: String(settings.left) },
            { key: "centre", title: "Centre", value: String(settings.centre) },
            { key: "right", title: "Right", value: String(settings.right) },
          ]}
          onChange={(key, v) => set(key as "left" | "centre" | "right", v)}
        />
      }
    >
      <div className={`${shell.panel} ${styles.bar}`}>
        {section(settings.left, styles.left)}
        {section(settings.centre, styles.centre)}
        {section(settings.right, styles.right)}
      </div>
    </OverlayShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TopBarOverlay />
  </StrictMode>,
);
