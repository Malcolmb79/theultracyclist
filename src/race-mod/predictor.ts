import type { RouteGeometry } from "../components/race/courseMap";
import type { RiderHistory } from "../components/race/raceLog";
import type { SauceAthleteData } from "../components/race/sauceFeed";
import { gradeBetween } from "./physics";

// Who's most likely to win the race, from everything known about the
// riders in it - a first version, deliberately simple and explainable:
//
// 1. The finish. Read from the route profile: a flat run-in is a sprint, a
//    short rise to the line is punchy, a long one is a climb. Each kind of
//    finish is won over a different effort - 15 seconds for a sprint, a
//    minute for a punchy one, 5 to 20 minutes for a climb - and a flat
//    sprint in the draft rewards raw watts as well as W/kg.
// 2. Each rider's ability over those efforts: the best of what they've
//    shown in this race (Sauce's peaks), their best in races over the last
//    90 days (ZwiftPower), and what their FTP suggests - put on one scale.
//    Racing Score and recent wins add a little for race craft.
// 3. Whether they're still in it: time down on the front of the race
//    matters less with a long way to go and everything at the end.
// 4. What they have left: W′ balance (matters more as the line nears) and
//    stamina (the ride's effort so far against FTP).
//
// Those make a score per rider, turned into chances that add up to 100%:
// early on the chances are spread (a lot can happen), and they sharpen
// towards the finish, when ability for the finish decides it.

export type FinishKind = "sprint" | "punchy" | "climb" | "unknown";

export interface Finish {
  kind: FinishKind;
  /** Gradient of the last kilometre and the last three, %. */
  lastKmPct?: number;
  last3KmPct?: number;
  remainingKm?: number;
}

/** How much each effort counts for each kind of finish, and how much raw watts count too. */
const WEIGHTS: Record<FinishKind, { s15: number; m1: number; m5: number; m20: number; watts: number }> = {
  sprint: { s15: 0.55, m1: 0.25, m5: 0.1, m20: 0.1, watts: 0.5 },
  punchy: { s15: 0.2, m1: 0.4, m5: 0.3, m20: 0.1, watts: 0.2 },
  climb: { s15: 0.05, m1: 0.15, m5: 0.4, m20: 0.4, watts: 0 },
  unknown: { s15: 0.2, m1: 0.25, m5: 0.3, m20: 0.25, watts: 0.25 },
};

/**
 * A typical rider's power over each effort as a multiple of FTP - to guess
 * an effort from FTP when nothing better is known, and to put the efforts
 * on one scale ("FTP-equivalent W/kg") so a sprinter's 15 s and a
 * climber's 20 min can be compared.
 */
const RATIO = { s15: 2.4, m1: 1.55, m5: 1.15, m20: 1.03 };
const DURATIONS = { s15: 15, m1: 60, m5: 300, m20: 1200 } as const;
type Effort = keyof typeof DURATIONS;
const EFFORTS = Object.keys(DURATIONS) as Effort[];

/** The finish, from the route's last three kilometres. */
export function readFinish(route: RouteGeometry | null, at: number | undefined, remainingM: number | undefined): Finish {
  const remainingKm = remainingM != null ? remainingM / 1000 : undefined;
  if (!route || at == null || remainingM == null || remainingM <= 0) return { kind: "unknown", remainingKm };
  const line = at + remainingM;
  const lastKmPct = gradeBetween(route, line - 1000, line) * 100;
  const last3KmPct = gradeBetween(route, line - 3000, line) * 100;
  const kind: FinishKind = last3KmPct >= 3.5 || lastKmPct >= 6 ? "climb" : lastKmPct >= 2 || last3KmPct >= 2 ? "punchy" : "sprint";
  return { kind, lastKmPct, last3KmPct, remainingKm };
}

type Stats = { power?: { np?: number; peaks?: Record<string, { avg?: number | null }> }; activeTime?: number };

export interface Chance {
  athleteId: number;
  /** 0-1. */
  chance: number;
  /** The reasons, strongest first, in a few words each. */
  why: string[];
}

interface Scored {
  id: number;
  ability: number;
  contention: number;
  fresh: number;
  form: number;
  why: { weight: number; text: string }[];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A rider's ability for this finish, on the FTP-equivalent W/kg scale. */
function abilityOf(r: SauceAthleteData, finish: Finish, zp: RiderHistory | null | undefined) {
  const w = WEIGHTS[finish.kind];
  const kg = r.athlete?.weight || undefined;
  const ftpWkg = r.athlete?.ftp && kg ? r.athlete.ftp / kg : undefined;
  const peaks = (r.stats as Stats | undefined)?.power?.peaks;
  const best = zp?.best90Days;
  const zpOf: Record<Effort, number | undefined> = { s15: best?.s15, m1: best?.m1, m5: best?.m5, m20: best?.m20 };
  let sum = 0;
  let weight = 0;
  let wattsSum = 0;
  const parts: Record<Effort, number | undefined> = { s15: undefined, m1: undefined, m5: undefined, m20: undefined };
  for (const e of EFFORTS) {
    const race = peaks?.[DURATIONS[e]]?.avg && kg ? peaks[DURATIONS[e]].avg! / kg : undefined;
    // The best evidence of what they can do: shown today, shown in recent
    // races (a little discounted), or guessed from FTP (more discounted).
    const known = [race, zpOf[e] != null ? zpOf[e]! * 0.97 : undefined, ftpWkg != null ? ftpWkg * RATIO[e] * 0.92 : undefined].filter(
      (x): x is number => x != null && x > 0,
    );
    if (!known.length) continue;
    const v = Math.max(...known);
    parts[e] = v;
    sum += (w[e] * v) / RATIO[e];
    weight += w[e];
    if (kg) wattsSum += (w[e] * v * kg) / RATIO[e] / 75;
  }
  if (!weight) return undefined;
  const wkg = sum / weight;
  // On the flat, in the draft, raw watts count as well as W/kg - as if everyone weighed 75 kg.
  const ability = kg ? (1 - w.watts) * wkg + w.watts * (wattsSum / weight) : wkg;
  return { ability, parts, ftpWkg };
}

const KIND_EFFORT: Record<FinishKind, Effort> = { sprint: "s15", punchy: "m1", climb: "m5", unknown: "m5" };
const EFFORT_LABEL: Record<Effort, string> = { s15: "15s", m1: "1min", m5: "5min", m20: "20min" };

/**
 * The chances of each rider in the race winning it. `riders` are the
 * rider's own race; `zp` their ZwiftPower history where it's been looked up.
 */
export function predict(riders: SauceAthleteData[], finish: Finish, zp: Map<number, RiderHistory | null>, holdFtpMin = 60): Chance[] {
  const remainingKm = finish.remainingKm ?? 20;
  // How near the end, 0 (40 km or more out) to 1 (the line).
  const near = clamp(1 - remainingKm / 40, 0, 1);
  // The front of the race: the rider furthest up the road.
  const front = Math.min(...riders.map((r) => r.gap ?? 0));

  const scored: Scored[] = [];
  const abilities: number[] = [];
  for (const r of riders) {
    const a = abilityOf(r, finish, zp.get(r.athleteId));
    if (a) abilities.push(a.ability);
    scored.push({ id: r.athleteId, ability: a?.ability ?? NaN, contention: 1, fresh: 1, form: 1, why: [] });
    const s = scored[scored.length - 1];
    const effort = KIND_EFFORT[finish.kind];
    if (a?.parts[effort] != null) {
      s.why.push({ weight: 2, text: `${EFFORT_LABEL[effort]} ${a.parts[effort]!.toFixed(1)} W/kg` });
    } else if (a?.ftpWkg) {
      s.why.push({ weight: 1, text: `FTP ${a.ftpWkg.toFixed(1)} W/kg` });
    }

    // Still in it: time down on the front counts for less with a long way to go.
    const deficit = Math.max(0, (r.gap ?? 0) - front);
    const tolerance = clamp(4 + 3.5 * remainingKm, 4, 120);
    s.contention = Math.exp(-deficit / tolerance);
    if (deficit < 3) s.why.push({ weight: 1.5, text: (r.gap ?? 0) - front < 0.5 && riders.length > 1 ? "at the front" : "in the front group" });
    else s.why.push({ weight: 3 - s.contention * 2, text: `${Math.round(deficit)}s down` });

    // What they have left: W′ (more so near the line) and stamina for the whole ride.
    const wPrime = r.athlete?.wPrime || 20_000;
    const wbal = r.wBal != null ? clamp(r.wBal / wPrime, 0, 1) : 1;
    const st = r.stats as Stats | undefined;
    const ftp = r.athlete?.ftp;
    const stamina =
      st?.power?.np && ftp && st.activeTime ? clamp(1 - (st.activeTime * (st.power.np / ftp) ** 4) / (holdFtpMin * 60), 0, 1) : 1;
    // An empty W′ in the last kilometres is no sprint at all; early on it refills.
    s.fresh = (1 - 0.85 * near ** 2 * (1 - wbal)) * (0.8 + 0.2 * stamina);
    if (r.wBal != null && wbal < 0.5) s.why.push({ weight: 1.2 + near, text: `W′ ${Math.round(wbal * 100)}%` });
    if (stamina < 0.3) s.why.push({ weight: 1, text: `stamina ${Math.round(stamina * 100)}%` });

    // Race craft: Racing Score, and winning lately.
    const zr = zp.get(r.athleteId);
    const wins = zr?.last30Days?.wins ?? 0;
    const score = r.athlete?.racingScore;
    s.form = 1 + Math.min(0.1, wins * 0.03);
    if (wins) s.why.push({ weight: 1.1, text: `${wins} ${wins === 1 ? "win" : "wins"} this month` });
    if (score) s.why.push({ weight: 0.5, text: `ZRS ${Math.round(score)}` });
    // Racing Score folded into ability, a little, where it's known (about 150 points a W/kg).
    if (score && Number.isFinite(s.ability)) s.ability = 0.8 * s.ability + 0.2 * (score / 150);
  }

  // Riders nothing is known about are taken to be about average.
  const sorted = abilities.slice().sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 3;
  for (const s of scored) if (!Number.isFinite(s.ability)) s.ability = median * 0.97;
  const top = Math.max(...scored.map((s) => s.ability));

  // Spread early, decisive late: how much ability for the finish separates them.
  const sharpness = 6 + 14 * near;
  const raw = scored.map((s) => Math.exp(sharpness * (s.ability / top - 1)) * s.contention * s.fresh * s.form);
  const total = raw.reduce((a, b) => a + b, 0) || 1;
  return scored
    .map((s, k) => ({
      athleteId: s.id,
      chance: raw[k] / total,
      why: s.why.sort((a, b) => b.weight - a.weight).map((w) => w.text),
    }))
    .sort((a, b) => b.chance - a.chance);
}
