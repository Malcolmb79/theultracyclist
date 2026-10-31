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
  /** Climbing between here and the last 3 km, m, and its steepest kilometre, %. */
  climbAheadM?: number;
  steepestAheadPct?: number;
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
  // What's still to be climbed before the run-in - where a race gets whittled down.
  let climbAheadM = 0;
  let steepestAheadPct = 0;
  for (let d = at; d + 100 <= line - 3000; d += 100) {
    const g = gradeBetween(route, d, d + 100);
    if (g > 0) climbAheadM += g * 100;
    if (d + 1000 <= line - 3000) steepestAheadPct = Math.max(steepestAheadPct, gradeBetween(route, d, d + 1000) * 100);
  }
  return { kind, lastKmPct, last3KmPct, remainingKm, climbAheadM, steepestAheadPct };
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

/** Riders projected this close at the line arrive together, and contest the finish. */
const ARRIVE_TOGETHER_S = 5;

const KIND_EFFORT: Record<FinishKind, Effort> = { sprint: "s15", punchy: "m1", climb: "m5", unknown: "m5" };
const EFFORT_LABEL: Record<Effort, string> = { s15: "15s", m1: "1min", m5: "5min", m20: "20min" };

/**
 * The chances of each rider in the race winning it. `riders` are the
 * rider's own race; `zp` their ZwiftPower history where it's been looked up.
 */
export function predict(
  riders: SauceAthleteData[],
  finish: Finish,
  zp: Map<number, RiderHistory | null>,
  /** Seconds each rider is losing (+) or gaining (−) on the rider watched, per km, lately. */
  trends: Map<number, number> = new Map(),
  holdFtpMin = 60,
): Chance[] {
  const remainingKm = finish.remainingKm ?? 20;
  // How near the end, 0 (40 km or more out) to 1 (the line).
  const near = clamp(1 - remainingKm / 40, 0, 1);
  // Where everyone will be at the line, at the rate they're losing or
  // gaining time now - eased, since a chase or a fade rarely holds all the
  // way. Someone away on their own who's being reeled in is projected caught.
  const projected = new Map<number, number>();
  const gaps = riders.map((r) => r.gap ?? 0).sort((a, b) => a - b);
  const bunch = gaps[Math.floor(gaps.length / 2)] ?? 0;
  for (const r of riders) {
    let trend = trends.get(r.athleteId);
    // Not measured yet: someone off the front of the bunch is assumed chased -
    // a lone rider faster than a small group - until their real rate is known.
    if (trend == null && (r.gap ?? 0) < bunch - 5) {
      const company = riders.filter((x) => Math.abs((x.gap ?? 0) - (r.gap ?? 0)) <= 3).length;
      trend = company <= 2 ? 2.5 : company <= 5 ? 1.5 : 0;
    }
    projected.set(r.athleteId, (r.gap ?? 0) + clamp(trend ?? 0, -15, 15) * remainingKm * 0.6);
  }
  const front = Math.min(...projected.values());
  // The climbing still to come before the run-in thins the field: up to fully selective by 400 m.
  const hilly = clamp((finish.climbAheadM ?? 0) / 400, 0, 1) * (finish.steepestAheadPct != null && finish.steepestAheadPct >= 4 ? 1 : 0.6);
  const climbing: number[] = [];

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

    // Still in it: projected time down on the front at the line, which
    // counts for less with a long way to go.
    const deficit = Math.max(0, projected.get(r.athleteId)! - front);
    const tolerance = clamp(3 + 1.2 * remainingKm, 3, 60);
    s.contention = Math.exp(-deficit / tolerance);
    const nowDown = Math.max(0, (r.gap ?? 0) - Math.min(...riders.map((x) => x.gap ?? 0)));
    const trend = trends.get(r.athleteId) ?? 0;
    if (nowDown < 3 && deficit > 10) s.why.push({ weight: 2.6, text: "likely caught" });
    else if (deficit < 3) s.why.push({ weight: 1.5, text: nowDown < 0.5 && riders.length > 1 ? "at the front" : "in the front group" });
    else s.why.push({ weight: 3 - s.contention * 2, text: `${Math.round(nowDown)}s down` });
    if (Math.abs(trend) >= 1.5 && remainingKm > 0.5) {
      s.why.push({ weight: 1.8, text: trend > 0 ? `losing ${trend.toFixed(0)}s/km` : `gaining ${(-trend).toFixed(0)}s/km` });
    }
    // Their climbing, for the hills still to come (5 and 20 min, W/kg).
    climbing.push(a?.parts.m5 != null || a?.parts.m20 != null ? ((a?.parts.m5 ?? a!.parts.m20!) / RATIO.m5 + (a?.parts.m20 ?? a!.parts.m5!) / RATIO.m20) / 2 : NaN);

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

  // Hills before the finish: those who climb worse than the best climbers
  // here are less likely to still be there for it.
  if (hilly > 0) {
    const best = Math.max(...climbing.filter(Number.isFinite));
    scored.forEach((s, k) => {
      const c = climbing[k];
      if (!Number.isFinite(c) || !Number.isFinite(best) || best <= 0) return;
      const short = 1 - c / best;
      s.contention *= Math.exp(-hilly * 6 * short);
      if (short > 0.08) s.why.push({ weight: 1.4 + hilly, text: `${Math.round(finish.climbAheadM ?? 0)} m of climbing to come` });
      else if (short < 0.02) s.why.push({ weight: 1 + hilly, text: "climbs well" });
    });
  }

  // Riders nothing is known about are taken to be about average.
  const sorted = abilities.slice().sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 3;
  for (const s of scored) if (!Number.isFinite(s.ability)) s.ability = median * 0.97;
  // Ability for the finish only matters against those arriving with you or
  // ahead of you: a rider projected to come in alone in front doesn't have
  // to out-sprint anyone - but one dropped behind still has to beat them.
  const together = (id: number) => {
    const mine = projected.get(id)!;
    return Math.max(...scored.filter((x) => projected.get(x.id)! <= mine + ARRIVE_TOGETHER_S).map((x) => x.ability));
  };

  // Spread early, decisive late: how much ability for the finish separates them.
  const sharpness = 6 + 14 * near;
  const raw = scored.map((s) => Math.exp(sharpness * (s.ability / together(s.id) - 1)) * s.contention * s.fresh * s.form);
  const total = raw.reduce((a, b) => a + b, 0) || 1;
  return scored
    .map((s, k) => ({
      athleteId: s.id,
      chance: raw[k] / total,
      why: s.why.sort((a, b) => b.weight - a.weight).map((w) => w.text),
    }))
    .sort((a, b) => b.chance - a.chance);
}
