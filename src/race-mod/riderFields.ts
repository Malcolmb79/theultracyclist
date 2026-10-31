import type { SauceAthleteData } from "../components/race/sauceFeed";

// Everything Sauce knows about a rider, as fields to pick from - for the
// Nearby riders table and the Rider cards. Grouped as Sauce's own Nearby
// Athletes settings are: athlete, event and road, power, speed, heart rate,
// cadence, draft, peaks and time. Each gives a number to sort by and the
// text to show; a field Sauce doesn't have for a rider (hidden FTP, no
// heart rate) shows a dash.

export type FieldGroup = "Athlete" | "Event / road" | "Power" | "Speed" | "Heart rate" | "Cadence" | "Draft" | "Peaks" | "Time";

export interface RiderField {
  id: string;
  /** In the settings and on a card. */
  label: string;
  /** A short column heading. */
  short: string;
  group: FieldGroup;
  value: (r: SauceAthleteData) => number | string | undefined;
  /** The value as shown; numbers default to whole. */
  show?: (v: number) => string;
}

// Sauce's per-rider stats, more than the typed part of the data carries.
type Bucket = {
  power?: { avg?: number; max?: number; np?: number; tss?: number; kj?: number; smooth?: Record<string, number | null>; peaks?: Record<string, { avg?: number | null }> };
  speed?: { avg?: number; max?: number; smooth?: Record<string, number | null> };
  hr?: { avg?: number; max?: number; smooth?: Record<string, number | null> };
  cadence?: { avg?: number; max?: number };
  draft?: { avg?: number; kj?: number };
  elapsedTime?: number;
  activeTime?: number;
  coffeeTime?: number;
  workTime?: number;
  followTime?: number;
  soloTime?: number;
  workKj?: number;
  followKj?: number;
  soloKj?: number;
};
type Rich = SauceAthleteData & { stats?: Bucket; lap?: Bucket; lastLap?: Bucket | null; isGapEst?: boolean };

const stats = (r: SauceAthleteData) => (r as Rich).stats;
const kg = (r: SauceAthleteData) => r.athlete?.weight || undefined;
const perKg = (w: number | null | undefined, r: SauceAthleteData) => (w != null && kg(r) ? w / kg(r)! : undefined);
const num = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? undefined : v);

const whole = (v: number) => String(Math.round(v));
const one = (v: number) => v.toFixed(1);
const wkg = (v: number) => `${v.toFixed(1)}`;
const pct = (v: number) => `${Math.round(v)}%`;
const kj = (v: number) => `${v.toFixed(v < 100 ? 1 : 0)}`;
export function clockOf(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`;
}
const gapOf = (v: number) => (Math.abs(v) < 0.5 ? "0" : `${v > 0 ? "+" : "−"}${Math.abs(v) < 60 ? Math.round(Math.abs(v)) : clockOf(Math.abs(v))}`);

/** A smoothed or peak power field, in watts or W/kg. */
function powerOver(period: number, label: string, kind: "smooth" | "peaks", perKgToo: boolean): RiderField {
  const get = (r: SauceAthleteData) => {
    const p = stats(r)?.power;
    return num(kind === "smooth" ? p?.smooth?.[period] : p?.peaks?.[period]?.avg);
  };
  return perKgToo
    ? {
        id: `${kind}${period}wkg`,
        label: `${label} (W/kg)`,
        short: `${label} W/kg`,
        group: kind === "smooth" ? "Power" : "Peaks",
        value: (r) => perKg(get(r), r),
        show: wkg,
      }
    : { id: `${kind}${period}`, label, short: label, group: kind === "smooth" ? "Power" : "Peaks", value: get, show: whole };
}

const FIELDS: RiderField[] = [
  // Athlete
  { id: "weight", label: "Weight", short: "Kg", group: "Athlete", value: (r) => kg(r), show: whole },
  { id: "ftp", label: "FTP", short: "FTP", group: "Athlete", value: (r) => num(r.athlete?.ftp), show: whole },
  { id: "ftpWkg", label: "FTP W/kg", short: "FTP W/kg", group: "Athlete", value: (r) => perKg(r.athlete?.ftp, r), show: wkg },
  { id: "category", label: "Category", short: "Cat", group: "Athlete", value: (r) => r.athlete?.racingCategory || undefined },
  { id: "score", label: "Racing Score", short: "ZRS", group: "Athlete", value: (r) => num(r.athlete?.racingScore), show: whole },
  { id: "level", label: "Level", short: "Lvl", group: "Athlete", value: (r) => num(r.athlete?.level), show: whole },
  { id: "team", label: "Team", short: "Team", group: "Athlete", value: (r) => r.athlete?.team?.trim() || undefined },
  { id: "powerMeter", label: "Power meter", short: "PM", group: "Athlete", value: (r) => (r.athlete?.powerMeter ? "✓" : undefined) },
  {
    id: "wbal",
    label: "W′ balance (kJ)",
    short: "W′bal",
    group: "Athlete",
    value: (r) => (r.wBal != null ? r.wBal / 1000 : undefined),
    show: one,
  },
  {
    id: "wbalPct",
    label: "W′ balance (%)",
    short: "W′ %",
    group: "Athlete",
    value: (r) => (r.wBal != null ? (r.wBal / (r.athlete?.wPrime || 20_000)) * 100 : undefined),
    show: pct,
  },
  { id: "tss", label: "TSS", short: "TSS", group: "Athlete", value: (r) => num(stats(r)?.power?.tss), show: whole },
  {
    id: "if",
    label: "Intensity Factor",
    short: "IF",
    group: "Athlete",
    value: (r) => (stats(r)?.power?.np && r.athlete?.ftp ? stats(r)!.power!.np! / r.athlete.ftp : undefined),
    show: (v) => v.toFixed(2),
  },
  { id: "energy", label: "Energy (kJ)", short: "kJ", group: "Athlete", value: (r) => num(stats(r)?.power?.kj), show: whole },

  // Event and road
  {
    id: "gap",
    label: "Gap",
    short: "Gap",
    group: "Event / road",
    value: (r) => num(r.gap),
    show: gapOf,
  },
  { id: "gapDistance", label: "Gap (distance, m)", short: "Gap m", group: "Event / road", value: (r) => num(r.gapDistance), show: whole },
  {
    id: "position",
    label: "Event position",
    short: "Pos",
    group: "Event / road",
    value: (r) => (r.eventPosition ? r.eventPosition : undefined),
    show: whole,
  },
  { id: "grade", label: "Grade", short: "Grade", group: "Event / road", value: (r) => (r.state?.grade != null ? r.state.grade * 100 : undefined), show: (v) => `${v.toFixed(1)}%` },
  {
    id: "distance",
    label: "Distance (km)",
    short: "Km",
    group: "Event / road",
    value: (r) => {
      const d = (r.state as { distance?: number } | null | undefined)?.distance;
      return d != null ? d / 1000 : undefined;
    },
    show: one,
  },

  // Power
  { id: "power", label: "Current power", short: "W", group: "Power", value: (r) => num(r.state?.power), show: whole },
  { id: "powerWkg", label: "Current W/kg", short: "W/kg", group: "Power", value: (r) => perKg(r.state?.power, r), show: wkg },
  {
    id: "ftpPct",
    label: "% of FTP now",
    short: "%FTP",
    group: "Power",
    value: (r) => (r.state?.power != null && r.athlete?.ftp ? (r.state.power / r.athlete.ftp) * 100 : undefined),
    show: pct,
  },
  powerOver(5, "5s", "smooth", false),
  powerOver(5, "5s", "smooth", true),
  powerOver(15, "15s", "smooth", false),
  powerOver(15, "15s", "smooth", true),
  powerOver(60, "1min", "smooth", false),
  powerOver(60, "1min", "smooth", true),
  powerOver(300, "5min", "smooth", false),
  powerOver(300, "5min", "smooth", true),
  powerOver(1200, "20min", "smooth", false),
  powerOver(1200, "20min", "smooth", true),
  { id: "avg", label: "Average power", short: "Avg W", group: "Power", value: (r) => num(stats(r)?.power?.avg), show: whole },
  { id: "avgWkg", label: "Average W/kg", short: "Avg W/kg", group: "Power", value: (r) => perKg(stats(r)?.power?.avg, r), show: wkg },
  { id: "np", label: "Normalised power", short: "NP", group: "Power", value: (r) => num(stats(r)?.power?.np), show: whole },
  { id: "npWkg", label: "NP (W/kg)", short: "NP W/kg", group: "Power", value: (r) => perKg(stats(r)?.power?.np, r), show: wkg },
  {
    id: "vi",
    label: "Variability Index",
    short: "VI",
    group: "Power",
    value: (r) => (stats(r)?.power?.np && stats(r)?.power?.avg ? stats(r)!.power!.np! / stats(r)!.power!.avg! : undefined),
    show: (v) => v.toFixed(2),
  },
  { id: "lapAvg", label: "Lap average", short: "Lap W", group: "Power", value: (r) => num((r as Rich).lap?.power?.avg), show: whole },
  { id: "lastLapAvg", label: "Last lap average", short: "Last lap W", group: "Power", value: (r) => num((r as Rich).lastLap?.power?.avg), show: whole },
  { id: "workKj", label: "Working energy (kJ)", short: "Work kJ", group: "Power", value: (r) => num(stats(r)?.workKj), show: kj },
  { id: "followKj", label: "Following energy (kJ)", short: "Follow kJ", group: "Power", value: (r) => num(stats(r)?.followKj), show: kj },
  { id: "soloKj", label: "Solo energy (kJ)", short: "Solo kJ", group: "Power", value: (r) => num(stats(r)?.soloKj), show: kj },

  // Speed
  { id: "speed", label: "Current speed", short: "km/h", group: "Speed", value: (r) => num(r.state?.speed), show: whole },
  { id: "speed60", label: "1 min speed", short: "1min km/h", group: "Speed", value: (r) => num(stats(r)?.speed?.smooth?.[60]), show: whole },
  { id: "speedAvg", label: "Average speed", short: "Avg km/h", group: "Speed", value: (r) => num(stats(r)?.speed?.avg), show: one },
  { id: "lapSpeed", label: "Lap speed", short: "Lap km/h", group: "Speed", value: (r) => num((r as Rich).lap?.speed?.avg), show: one },

  // Heart rate
  { id: "hr", label: "Current heart rate", short: "♥", group: "Heart rate", value: (r) => num(r.state?.heartrate || undefined), show: whole },
  { id: "hr60", label: "1 min heart rate", short: "1min ♥", group: "Heart rate", value: (r) => num(stats(r)?.hr?.smooth?.[60]), show: whole },
  { id: "hrAvg", label: "Average heart rate", short: "Avg ♥", group: "Heart rate", value: (r) => num(stats(r)?.hr?.avg), show: whole },
  { id: "hrMax", label: "Max heart rate", short: "Max ♥", group: "Heart rate", value: (r) => num(stats(r)?.hr?.max), show: whole },

  // Cadence
  { id: "cadence", label: "Current cadence", short: "rpm", group: "Cadence", value: (r) => num(r.state?.cadence || undefined), show: whole },
  { id: "cadenceAvg", label: "Average cadence", short: "Avg rpm", group: "Cadence", value: (r) => num(stats(r)?.cadence?.avg), show: whole },

  // Draft
  {
    id: "draft",
    label: "Current draft",
    short: "Draft",
    group: "Draft",
    value: (r) => num((r.state as { draft?: number } | null | undefined)?.draft),
    show: whole,
  },
  { id: "draftAvg", label: "Average draft", short: "Avg draft", group: "Draft", value: (r) => num(stats(r)?.draft?.avg), show: whole },
  { id: "draftKj", label: "Energy saved (kJ)", short: "Saved kJ", group: "Draft", value: (r) => num(stats(r)?.draft?.kj), show: kj },

  // Peaks
  { id: "maxPower", label: "Max power", short: "Max W", group: "Peaks", value: (r) => num(stats(r)?.power?.max), show: whole },
  { id: "maxWkg", label: "Max W/kg", short: "Max W/kg", group: "Peaks", value: (r) => perKg(stats(r)?.power?.max, r), show: wkg },
  powerOver(5, "Best 5s", "peaks", false),
  powerOver(5, "Best 5s", "peaks", true),
  powerOver(15, "Best 15s", "peaks", false),
  powerOver(15, "Best 15s", "peaks", true),
  powerOver(60, "Best 1min", "peaks", false),
  powerOver(60, "Best 1min", "peaks", true),
  powerOver(300, "Best 5min", "peaks", false),
  powerOver(300, "Best 5min", "peaks", true),
  powerOver(1200, "Best 20min", "peaks", false),
  powerOver(1200, "Best 20min", "peaks", true),

  // Time
  { id: "activeTime", label: "Active time", short: "Active", group: "Time", value: (r) => num(stats(r)?.activeTime), show: clockOf },
  { id: "elapsedTime", label: "Elapsed time", short: "Elapsed", group: "Time", value: (r) => num(stats(r)?.elapsedTime), show: clockOf },
  { id: "workTime", label: "Working time", short: "Working", group: "Time", value: (r) => num(stats(r)?.workTime), show: clockOf },
  { id: "followTime", label: "Following time", short: "Following", group: "Time", value: (r) => num(stats(r)?.followTime), show: clockOf },
  { id: "soloTime", label: "Solo time", short: "Solo", group: "Time", value: (r) => num(stats(r)?.soloTime), show: clockOf },
  { id: "coffeeTime", label: "Coffee time", short: "Coffee", group: "Time", value: (r) => num(stats(r)?.coffeeTime), show: clockOf },
];

/** The groups in the order columns and cards show them: where and how hard first, totals last. */
export const FIELD_GROUPS: FieldGroup[] = ["Event / road", "Power", "Speed", "Heart rate", "Cadence", "Draft", "Peaks", "Athlete", "Time"];

export const RIDER_FIELDS: RiderField[] = FIELD_GROUPS.flatMap((g) => FIELDS.filter((f) => f.group === g));

export const fieldById = new Map(RIDER_FIELDS.map((f) => [f.id, f]));

/** The chosen fields, kept in a setting as "a,b,c", in the catalogue's order. */
export function chosen(setting: string): RiderField[] {
  const ids = new Set(setting.split(",").filter(Boolean));
  return RIDER_FIELDS.filter((f) => ids.has(f.id));
}

export function display(f: RiderField, r: SauceAthleteData): string {
  const v = f.value(r);
  if (v == null || v === "") return "–";
  return typeof v === "number" ? (f.show ?? whole)(v) : v;
}

/** Whether a gap was guessed by Sauce, for an "est" mark. */
export const gapIsEstimate = (r: SauceAthleteData) => !!(r as Rich).isGapEst;
