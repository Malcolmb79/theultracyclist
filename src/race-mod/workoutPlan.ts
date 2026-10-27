// A Zwift workout as blocks to draw and follow, from the workout file Zwift
// sends Sauce over its Game Connection (getWorkoutStatus). The file is a
// .zwo - <workout_file><workout> and the blocks in order - which Sauce
// passes on parsed into elements: {type, name, attributes, children}.
//
// Each block becomes one or more steps with a start, a length and a target
// as a share of FTP (at the start and the end, for ramps); repeats
// (IntervalsT) are laid out as their on and off steps. Lengths are in the
// workout's own unit: seconds, or metres for a distance workout.

export interface XmlNode {
  type?: string;
  name?: string;
  attributes?: Record<string, string>;
  children?: XmlNode[];
  text?: string;
}

export type StepKind = "warmup" | "cooldown" | "steady" | "on" | "off" | "ramp" | "free" | "max";

export interface Step {
  kind: StepKind;
  /** Where it starts and how long it is, in seconds (or metres). */
  start: number;
  length: number;
  /** Target as a share of FTP at the start and the end; none for free riding and max efforts. */
  from?: number;
  to?: number;
  /** Cadence target, rpm. */
  cadence?: number;
  /** For repeats: which one and how many, e.g. 2 of 4. */
  rep?: number;
  reps?: number;
}

export interface TextCue {
  at: number;
  message: string;
}

export interface WorkoutPlan {
  name?: string;
  steps: Step[];
  total: number;
  cues: TextCue[];
}

function num(a: Record<string, string> | undefined, ...keys: string[]): number | undefined {
  for (const k of keys) {
    // Zwift's files aren't consistent about case.
    const v = a?.[k] ?? a?.[k.toLowerCase()];
    if (v != null && v !== "" && Number.isFinite(Number(v))) return Number(v);
  }
  return undefined;
}

/** Shares of FTP; a file with watts (over 3) is turned into a share with the rider's FTP. */
function share(v: number | undefined, ftp: number | undefined): number | undefined {
  if (v == null) return undefined;
  return v > 3 && ftp ? v / ftp : v;
}

const elements = (n: XmlNode | undefined) => (n?.children ?? []).filter((c) => c.type === "element" || (c.name && c.type !== "text"));

function find(n: XmlNode | undefined, name: string): XmlNode | undefined {
  if (!n) return undefined;
  if (n.name?.toLowerCase() === name) return n;
  for (const c of elements(n)) {
    const f = find(c, name);
    if (f) return f;
  }
  return undefined;
}

function textOf(n: XmlNode | undefined): string | undefined {
  const t = (n?.children ?? []).map((c) => c.text ?? "").join("").trim();
  return t || undefined;
}

export function parseWorkout(file: XmlNode | null | undefined, ftp?: number): WorkoutPlan | null {
  const workout = find(file ?? undefined, "workout");
  if (!workout) return null;
  const steps: Step[] = [];
  const cues: TextCue[] = [];
  let t = 0;
  const push = (s: Omit<Step, "start">) => {
    if (!(s.length > 0)) return;
    steps.push({ ...s, start: t });
    t += s.length;
  };
  for (const b of elements(workout)) {
    const a = b.attributes;
    const name = b.name?.toLowerCase() ?? "";
    const blockStart = t;
    const cadence = num(a, "Cadence");
    if (name === "intervalst") {
      const reps = Math.max(1, Math.round(num(a, "Repeat") ?? 1));
      const on = num(a, "OnDuration") ?? 0;
      const off = num(a, "OffDuration") ?? 0;
      const onP = share(num(a, "OnPower", "PowerOnHigh", "PowerOnLow"), ftp);
      const offP = share(num(a, "OffPower", "PowerOffHigh", "PowerOffLow"), ftp);
      for (let r = 1; r <= reps; r++) {
        push({ kind: "on", length: on, from: onP, to: onP, cadence: num(a, "Cadence"), rep: r, reps });
        push({ kind: "off", length: off, from: offP, to: offP, cadence: num(a, "CadenceResting"), rep: r, reps });
      }
    } else if (name === "warmup" || name === "cooldown" || name === "ramp") {
      const lo = share(num(a, "PowerLow", "Power"), ftp);
      const hi = share(num(a, "PowerHigh", "Power"), ftp);
      push({ kind: name === "ramp" ? "ramp" : name, length: num(a, "Duration") ?? 0, from: lo, to: hi, cadence });
    } else if (name === "steadystate" || name === "solidstate") {
      const p = share(num(a, "Power", "PowerHigh", "PowerLow"), ftp);
      push({ kind: "steady", length: num(a, "Duration") ?? 0, from: p, to: p, cadence });
    } else if (name === "freeride" || name === "freeridesegment") {
      push({ kind: "free", length: num(a, "Duration") ?? 0, cadence });
    } else if (name === "maxeffort") {
      push({ kind: "max", length: num(a, "Duration") ?? 0 });
    } else {
      continue;
    }
    // Messages shown during the block, timed from its start.
    for (const c of elements(b)) {
      if (c.name?.toLowerCase() !== "textevent") continue;
      const at = num(c.attributes, "timeoffset", "TimeOffset", "distoffset");
      const message = c.attributes?.message ?? c.attributes?.Message;
      if (at != null && message) cues.push({ at: blockStart + at, message });
    }
  }
  if (!steps.length) return null;
  return { name: textOf(find(file ?? undefined, "name")), steps, total: t, cues };
}

/** The target, as a share of FTP, at a point in a step. */
export function targetAt(step: Step, at: number): number | undefined {
  if (step.from == null) return undefined;
  const f = step.length > 0 ? Math.max(0, Math.min(1, (at - step.start) / step.length)) : 0;
  return step.from + ((step.to ?? step.from) - step.from) * f;
}

export function stepAt(plan: WorkoutPlan, at: number): number {
  for (let i = 0; i < plan.steps.length; i++) {
    const s = plan.steps[i];
    if (at < s.start + s.length) return i;
  }
  return plan.steps.length - 1;
}

/** A step's name, the way a coach would say it. */
export function stepName(s: Step): string {
  const of = s.reps && s.reps > 1 ? ` ${s.rep}/${s.reps}` : "";
  switch (s.kind) {
    case "warmup":
      return "Warm-up";
    case "cooldown":
      return "Cool-down";
    case "on":
      return `Interval${of}`;
    case "off":
      return `Recovery${of}`;
    case "ramp":
      return "Ramp";
    case "free":
      return "Free ride";
    case "max":
      return "Max effort";
    default:
      return "Steady";
  }
}

/**
 * A workout as Sauce's getWorkout returns it - its own reading of the .zwo:
 * { name, workout: [{ type: "warmup", Duration, PowerLow, ... , textEvents }] } -
 * turned back into elements, so it reads like the file Zwift sends.
 */
export function fromSauceWorkout(w: unknown): XmlNode | null {
  const o = w as { name?: unknown; workout?: unknown } | null;
  if (!o || !Array.isArray(o.workout)) return null;
  const blocks: XmlNode[] = (o.workout as Record<string, unknown>[]).map((b) => {
    const { type, textEvents, ...rest } = b;
    const attributes = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, String(v)]));
    const children = Array.isArray(textEvents)
      ? (textEvents as Record<string, unknown>[]).map((t) => ({
          type: "element",
          name: "textevent",
          attributes: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, String(v)])),
        }))
      : [];
    return { type: "element", name: String(type ?? ""), attributes, children };
  });
  const name = typeof o.name === "string" ? o.name : undefined;
  return {
    type: "element",
    name: "workout_file",
    children: [
      ...(name ? [{ type: "element", name: "name", children: [{ type: "text", text: name }] }] : []),
      { type: "element", name: "workout", children: blocks },
    ],
  };
}
