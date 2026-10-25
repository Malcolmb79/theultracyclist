import { FINALE_M, FINALE_SEC, type EventBrief, type GroupSummary, type RaceEvent, type RaceLog, type RaceSample } from "./raceLog";

// Live commentary and tactics: a compact snapshot of the race goes to
// /api/race-commentary, a line comes back, and it's read aloud. Commentary
// talks about the rider like a broadcaster; tactics talks to them like a
// coach on the radio. See api/_routes/race-commentary.ts for what the model
// is told the snapshot means.

export type RadioMode = "commentary" | "tactics";

/** How the commentator and coach call riders: the viewer's choice. */
export type NameStyle = "surname" | "first" | "full";

/** The name to say for the rider, in the chosen style, team tags left off. */
export function callName(rider: RaceLog["rider"], style: NameStyle): string | undefined {
  if (!rider) return undefined;
  const first = rider.firstName;
  const last = rider.lastName;
  const full = [first, last].filter(Boolean).join(" ") || rider.name;
  if (style === "first") return first || full;
  if (style === "surname") return last || full;
  return full;
}

/**
 * How often each mode speaks. The coach never speaks on a timer: only when
 * there's a new key moment (see keyMoments), and not more often than this.
 * The commentator's timing depends on the chosen pace (COMMENTARY_PACE).
 */
export const RADIO_TIMING: Record<RadioMode, { everyMs: number; minGapMs: number }> = {
  commentary: { everyMs: 60_000, minGapMs: 20_000 },
  // At least 20s between calls in the race; the finale has its own gap (TACTICS_FINALE_GAP_MS).
  tactics: { everyMs: Infinity, minGapMs: 20_000 },
};

/**
 * How talkative the commentator is. It doesn't speak on a timer: what
 * happens in the race builds up "interest" (see INTEREST), and it speaks
 * once enough has built up since its last line - so a quiet stretch stays
 * quiet and a lively one gets called. threshold is how much it takes;
 * everyMs is the longest it will stay silent anyway, roughly (varied by a
 * fifth so the lines don't fall on a beat); minGapMs the shortest gap.
 */
export type CommentaryPace = "chatty" | "relaxed" | "sparse";
export const COMMENTARY_PACE: Record<
  CommentaryPace,
  { threshold: number; everyMs: number; minGapMs: number; label: string }
> = {
  chatty: { threshold: 2, everyMs: 90_000, minGapMs: 12_000, label: "Chatty" },
  relaxed: { threshold: 3, everyMs: 4 * 60_000, minGapMs: 20_000, label: "Relaxed" },
  sparse: { threshold: 5, everyMs: 8 * 60_000, minGapMs: 40_000, label: "Big moments only" },
};

/**
 * How interesting each kind of race event is. A split or an attack is a
 * story on its own; a rider sliding a few places is worth a line only with
 * something else going on. Moments read from the numbers (a gap closing, a
 * surge in the group, the road tipping up) count INTEREST_MOMENT each.
 */
const INTEREST: Partial<Record<RaceEvent["kind"], number>> = {
  split: 3,
  merge: 2.5,
  attack: 3,
  leader: 3,
  dropped: 2,
  bridged: 2,
  surge: 2,
  position: 1.5,
  powerup: 1,
  distance: 1,
  chat: 0.5,
  watching: 3,
  go: 4,
  finish: 5,
  result: 4,
};
const INTEREST_MOMENT = 2;

/** How much has happened since `sinceT`, by the weights above. */
export function interestSince(log: RaceLog, sinceT: number, moments: KeyMoment[]): number {
  let score = moments.length * INTEREST_MOMENT;
  for (const e of log.events) if (e.t > sinceT) score += INTEREST[e.kind] ?? 0;
  return score;
}

/** The next quiet spell: everyMs give or take a fifth. */
export function nextSilenceMs(everyMs: number): number {
  return Number.isFinite(everyMs) ? everyMs * (0.8 + Math.random() * 0.4) : everyMs;
}
/** The event kind each mode's lines are logged under. */
export const LINE_KIND: Record<RadioMode, "commentary" | "tactic"> = { commentary: "commentary", tactics: "tactic" };
/** Five minutes of effort is what tells a coach whether a rider can go again. */
const EFFORT_WINDOW_MS = 5 * 60_000;
/** How far back to look to tell whether a gap is opening or closing. */
const TREND_MS = 30_000;
/** Below this the anaerobic reserve is nearly gone - a coach would say so. */
const LOW_WBAL_J = 5000;
/** A gap this small can be bridged, or can catch you. */
const CLOSE_GAP_SEC = 8;
/** A gap moving this much in 30 seconds is a move, not noise. */
const GAP_MOVE_SEC = 1.5;
/** A group's power jumping this much in 15 seconds is an attack. */
const SURGE_RATIO = 1.2;
const SURGE_MIN_WATTS = 40;
/** Riding this far over the group's average for 20 seconds is towing it. */
const TOWING_WATTS = 60;
const TOWING_MS = 30_000;
/** The road tipping up: from under 2% to at least this. */
const CLIMB_PCT = 4;
/** A climb worth calling the top of: at least this long at CLIMB_PCT or more. */
const CLIMB_MIN_MS = 45_000;
/** Over the limit on a climb: this far over FTP for 20 seconds... */
const CLIMB_OVER_FTP = 1.08;
/** ...with the anaerobic reserve under this share of a fresh 20 kJ. */
const CLIMB_WBAL_J = 12_000;
/** A smaller group going clear just in front: within this many seconds, and growing. */
const GAP_OPENING_SEC = 5;
/**
 * How long a moment stays said before the same one can be called again.
 * Moments whose id carries "@" (an event, a pen briefing) are called once.
 */
export const MOMENT_COOLDOWN_MS = 90_000;
/** In the finale every few seconds matter: the coach can call as often as this. */
export const TACTICS_FINALE_GAP_MS = 6_000;
/** Race events that are key moments for the coach in their own right. */
/**
 * Race events that are decision points for the coach in their own right.
 * Moves through the field aren't - the coach isn't there to narrate them -
 * and of the distance markers only the ones where positioning and the
 * timing of the final effort are decided count (TACTIC_MARKERS).
 */
const MOMENT_EVENTS = new Set<RaceEvent["kind"]>(["split", "merge", "distance", "go", "attack", "powerup"]);
const TACTIC_MARKERS = /^(1 km|500 m|200 m) to go$/;
/** Countdown calls in the pen, seconds before the start - the last one just before the off. */
const COUNTDOWN_CALLS_SEC = [120, 60, 15];


/** Where the race is: waiting to start, under way, the last kilometre, or over. */
export type RacePhase = "pen" | "racing" | "finale" | "finished";

export function racePhase(log: RaceLog): RacePhase {
  if (log.events.some((e) => e.kind === "finish")) return "finished";
  const now = log.samples.at(-1);
  if (now?.pen) return "pen";
  const left = now?.remaining;
  if (left != null && left > 0 && left <= (log.remainingMetric === "time" ? FINALE_SEC : FINALE_M)) return "finale";
  return "racing";
}

/**
 * The commentator's timing outside the race proper, whatever the chosen
 * pace. In the pen it's the build-up, with the field to talk through and
 * nothing else happening; in the finale any event is worth a line, almost
 * blow by blow; after the finish it only speaks as results come in.
 */
export const PHASE_TIMING: Partial<Record<RacePhase, { threshold: number; everyMs: number; minGapMs: number }>> = {
  pen: { threshold: 3, everyMs: 50_000, minGapMs: 15_000 },
  finale: { threshold: 1, everyMs: 20_000, minGapMs: 5_000 },
  finished: { threshold: 3, everyMs: Infinity, minGapMs: 8_000 },
};
const WINDOW_MS = 60_000;
const RECENT_EVENTS = 8;
/** Enough of what was just said to carry the conversation on from it. */
const RECENT_LINES = 6;

function avg(values: (number | undefined)[]): number | undefined {
  const xs = values.filter((v): v is number => v != null);
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : undefined;
}

function eventLine(e: RaceEvent) {
  return { atSec: Math.round(e.t / 1000), kind: e.kind, text: e.text };
}


/** The nearest group either side of the rider's, and which way its gap is going. */
function neighbour(log: RaceLog, side: "ahead" | "behind") {
  const pick = (groups: GroupSummary[]) => {
    const i = groups.findIndex((g) => g.watching);
    if (i < 0) return undefined;
    return side === "ahead" ? groups[i - 1] : groups[i + 1];
  };
  const latest = log.groups.at(-1);
  const g = latest && pick(latest.groups);
  if (!g) return undefined;
  const then = log.groups.find((x) => x.t >= latest.t - TREND_MS);
  const before = then && then !== latest ? pick(then.groups) : undefined;
  const gap = Math.abs(g.gap);
  return {
    gapSec: gap,
    // Positive means the gap has grown over the last 30 seconds.
    gapChange30s: before ? Math.round((gap - Math.abs(before.gap)) * 10) / 10 : undefined,
    riders: g.size,
    avgPower: g.power,
    speedKmh: g.speed,
  };
}

function formatWait(sec: number): string {
  if (sec < 60) return `${sec} seconds`;
  const m = Math.round(sec / 60);
  return m === 1 ? "a minute" : `${m} minutes`;
}

/** The event in one breath, from what Sauce knows of it. */
function describeEvent(ev: EventBrief | undefined, riders: number | undefined): string {
  if (!ev) return riders ? `${riders} riders signed in.` : "Event details aren't in yet.";
  const parts = [
    ev.name ? `${ev.name}${ev.label ? ` (${ev.label})` : ""}` : undefined,
    ev.durationMin ? `${ev.durationMin} minutes` : ev.distanceKm ? `${ev.distanceKm} km` : undefined,
    ev.laps && ev.laps > 1 ? `${ev.laps} laps` : undefined,
    ev.climbM != null ? `${ev.climbM} m of climbing` : undefined,
    riders ? `${riders} riders` : undefined,
    ev.powerUps === false ? "no power-ups" : ev.powerUps ? "power-ups on" : undefined,
  ].filter(Boolean);
  return parts.length ? `${parts.join(", ")}.` : "";
}

/** The strongest riders in sight, by racing score, for the pen briefing. */
function ridersToWatch(log: RaceLog): string {
  const riders = log.field?.toWatch ?? [];
  if (!riders.length) return "";
  const mine = log.rider?.profile?.racingScore;
  const list = riders.map((r) => {
    const p = r.profile;
    const bits = [p?.racingScore != null ? `racing score ${p.racingScore}` : undefined, p?.category, p?.type].filter(Boolean);
    return `${r.name}${bits.length ? ` (${bits.join(", ")})` : ""}`;
  });
  return ` Riders to watch: ${list.join("; ")}.${mine != null ? ` Your racing score: ${mine}.` : ""}`;
}

export interface KeyMoment {
  /** Same id, same moment: it isn't called again until the cooldown passes. */
  id: string;
  text: string;
}

/**
 * A rough power target to close a gap in 30 seconds: the speed needed to
 * take `gap` seconds out of the group ahead in that time, scaled from the
 * rider's own power and speed now - by the cube of speed on the flat (air
 * resistance), roughly in proportion uphill. An estimate for a coach to
 * round, not a physics model; drafting alone can change it a lot.
 */
function bridgeTarget(gapSec: number, aheadKmh: number | undefined, now: RaceSample | undefined) {
  if (!aheadKmh || !now?.speed || !now.power) return undefined;
  const targetKmh = aheadKmh * (1 + gapSec / 30);
  const ratio = targetKmh / now.speed;
  const watts = (now.grade ?? 0) > 2 ? now.power * ratio : now.power * ratio ** 3;
  return { targetKmh: Math.round(targetKmh * 10) / 10, roughWatts: Math.round(watts / 10) * 10 };
}

/**
 * The moments a coach would get on the radio for, worked out from the
 * numbers so the coach speaks about something real and specific, each with
 * the figures that make it actionable: a gap opening or closing either side,
 * a surge in the rider's own group, the rider towing it, the road tipping
 * up, the tank running dry - plus the race log's splits, merges, moves
 * through the field and distance markers since `sinceT`.
 */
/** A rival with this little W′ left, and falling, is a moment: attack them, or watch them go. */
const LIMIT_W_BAL_PCT = 20;

/** How far before a climb or sprint the coach is asked to plan for it. */
const SEGMENT_WARNING_KM = 1.5;

export function keyMoments(log: RaceLog, sinceT: number, clock = Date.now()): KeyMoment[] {
  const moments: KeyMoment[] = [];
  const samples = log.samples;
  const now = samples.at(-1);
  if (!now) return moments;

  // In the start pen nothing on the road means anything yet: the coach
  // briefs the race once, then counts down to the start.
  // The race is over for the rider; the coach has nothing left to call.
  if (log.events.some((e) => e.kind === "finish")) return moments;

  // Ids carrying "@" are one-off: called once for this pen, never again.
  if (now.pen) {
    const ev = log.event;
    const penT = log.events.findLast((e) => e.kind === "pen")?.t ?? 0;
    const startsIn = ev?.startsAt != null ? Math.round((ev.startsAt - clock) / 1000) : undefined;
    // Give Sauce a few seconds to look the event up before briefing without it.
    if (ev || now.t - penT > 10_000) {
      moments.push({
        id: `briefing@${penT}`,
        text: `In the start pen. ${describeEvent(ev, now.of)}${startsIn != null && startsIn > 0 ? ` Starts in ${formatWait(startsIn)}.` : ""}${ridersToWatch(log)}`,
      });
    }
    if (startsIn != null && startsIn > 0) {
      const call = COUNTDOWN_CALLS_SEC.filter((c) => startsIn <= c).at(-1);
      if (call != null) moments.push({ id: `countdown@${penT}-${call}`, text: `${formatWait(startsIn)} to the start.` });
    }
    return moments;
  }

  const ahead = neighbour(log, "ahead");
  if (ahead && ahead.gapSec <= CLOSE_GAP_SEC && ahead.gapChange30s != null) {
    const who = `the group ahead (${ahead.riders} riders, ${Math.round(ahead.avgPower ?? 0)} W average)`;
    if (ahead.gapChange30s <= -GAP_MOVE_SEC) {
      const b = bridgeTarget(ahead.gapSec, ahead.speedKmh, now);
      moments.push({
        id: "bridge",
        text:
          `Closing on ${who}: ${ahead.gapSec.toFixed(1)}s now, ${Math.abs(ahead.gapChange30s).toFixed(1)}s taken out in the last 30s.` +
          (b ? ` To close it in 30s: about ${b.targetKmh} km/h, roughly ${b.roughWatts} W.` : ""),
      });
    } else if (ahead.gapChange30s >= GAP_MOVE_SEC) {
      const b = bridgeTarget(ahead.gapSec, ahead.speedKmh, now);
      moments.push({
        id: "slipping",
        text:
          `${who[0].toUpperCase()}${who.slice(1)} is getting away: ${ahead.gapSec.toFixed(1)}s, up ${ahead.gapChange30s.toFixed(1)}s in 30s.` +
          (b ? ` Bridging in 30s would take about ${b.targetKmh} km/h, roughly ${b.roughWatts} W.` : ""),
      });
    }
  }

  const behind = neighbour(log, "behind");
  if (behind && behind.gapSec <= CLOSE_GAP_SEC && behind.gapChange30s != null && behind.gapChange30s <= -GAP_MOVE_SEC) {
    moments.push({
      id: "caught",
      text: `The group behind (${behind.riders} riders, ${Math.round(behind.avgPower ?? 0)} W average) is ${behind.gapSec.toFixed(1)}s back and has gained ${Math.abs(behind.gapChange30s).toFixed(1)}s in 30s.`,
    });
  }

  // The rider's own group: an attack inside it, or the rider towing it.
  const latest = log.groups.at(-1);
  const own = latest?.groups.find((g) => g.watching);
  const earlier = log.groups.findLast((x) => latest && x.t <= latest.t - 15_000)?.groups.find((g) => g.watching);
  if (own?.power != null && earlier?.power != null && own.size > 1) {
    if (own.power >= earlier.power * SURGE_RATIO && own.power - earlier.power >= SURGE_MIN_WATTS) {
      moments.push({
        id: "surge",
        text: `Your group's average jumped from ${Math.round(earlier.power)} W to ${Math.round(own.power)} W in 15s - the pace is going up.`,
      });
    }
  }
  if (own?.power != null && own.size > 2) {
    const recent = samples.filter((s) => s.t >= now.t - TOWING_MS);
    const mine = avg(recent.map((s) => s.power));
    if (recent.length >= (TOWING_MS / 1000) * 0.75 && mine != null && mine - own.power >= TOWING_WATTS) {
      moments.push({
        id: "towing",
        text: `You've averaged ${mine} W for ${TOWING_MS / 1000}s, ${Math.round(mine - own.power)} W more than your group of ${own.size} (${Math.round(own.power)} W).`,
      });
    }
  }

  const gradeNow = avg(samples.filter((s) => s.t >= now.t - 10_000).map((s) => s.grade));
  const gradeBefore = avg(samples.filter((s) => s.t >= now.t - 40_000 && s.t < now.t - 20_000).map((s) => s.grade));
  if (gradeNow != null && gradeBefore != null && gradeNow >= CLIMB_PCT && gradeBefore < 2) {
    const ftp = log.rider?.ftp;
    moments.push({
      id: "climb",
      text:
        `The road has kicked up to ${gradeNow}% (from ${gradeBefore}%).` +
        (ftp ? ` FTP is ${ftp} W; anaerobic reserve ${now.wBal != null ? `${(now.wBal / 1000).toFixed(1)} kJ` : "unknown"}.` : ""),
    });
  }

  // On a climb: how long it has gone on, and whether the rider is over the limit.
  const climbing: RaceSample[] = [];
  for (let i = samples.length - 1; i >= 0 && (samples[i].grade ?? 0) >= CLIMB_PCT - 1; i--) climbing.push(samples[i]);
  const climbMs = climbing.length ? now.t - climbing[climbing.length - 1].t : 0;
  const ftp = log.rider?.ftp;
  if (ftp && climbMs >= 20_000) {
    const last20 = avg(samples.filter((s) => s.t >= now.t - 20_000).map((s) => s.power));
    if (last20 != null && last20 >= ftp * CLIMB_OVER_FTP && now.wBal != null && now.wBal < CLIMB_WBAL_J) {
      moments.push({
        id: "climb-limit",
        text: `${Math.round(climbMs / 1000)}s into the climb at ${avg(climbing.map((s) => s.grade))}%: ${last20} W for 20s, ${Math.round((last20 / ftp) * 100)}% of FTP, anaerobic reserve down to ${(now.wBal / 1000).toFixed(1)} kJ.`,
      });
    }
  }

  // The top: the road easing after a real climb - where moves go.
  const gradeEarlier = avg(samples.filter((s) => s.t >= now.t - 60_000 && s.t < now.t - 15_000).map((s) => s.grade));
  const climbBefore = samples.filter((s) => s.t >= now.t - 60_000 - CLIMB_MIN_MS && s.t < now.t - 15_000 && (s.grade ?? 0) >= CLIMB_PCT);
  if (gradeNow != null && gradeEarlier != null && gradeNow < 2 && gradeEarlier >= CLIMB_PCT && climbBefore.length * 1000 >= CLIMB_MIN_MS) {
    moments.push({
      id: "climb-top",
      text: `Over the top: the road has eased to ${gradeNow}% after ${Math.round((climbBefore.length * 1000) / 1000)}s at ${gradeEarlier}% or so.` +
        (ahead ? ` Group ahead ${ahead.gapSec.toFixed(1)}s up.` : "") +
        (behind ? ` Group behind ${behind.gapSec.toFixed(1)}s back.` : ""),
    });
  }

  // A smaller group going clear just in front: the gap is still closable.
  if (ahead && ahead.gapSec <= GAP_OPENING_SEC && (ahead.gapChange30s ?? 0) > 0.5 && own && ahead.riders < own.size) {
    const b = bridgeTarget(ahead.gapSec, ahead.speedKmh, now);
    moments.push({
      id: "gap-opening",
      text:
        `A gap is opening in front: ${ahead.riders} riders ${ahead.gapSec.toFixed(1)}s clear of your ${own.size} and growing.` +
        (b ? ` About ${b.roughWatts} W for 30s closes it.` : ""),
    });
  }

  if (now.wBal != null && now.wBal < LOW_WBAL_J) {
    moments.push({ id: "tank", text: `Anaerobic reserve is down to ${(now.wBal / 1000).toFixed(1)} kJ.` });
  }

  // A rival close to empty, in the rider's group or the one ahead: the
  // moment to attack them, or the warning that they're about to be dropped.
  const rivals = log.field?.rivals ?? [];
  const nearby = [...(log.field?.ridersGroup ?? []), ...(log.field?.groupAhead ?? [])];
  for (const r of nearby) {
    const c = r.condition;
    if (r.name === log.rider?.name || !c || c.wBalPct == null) continue;
    const isRival = rivals.some((x) => x.name === r.name);
    if (c.wBalPct <= LIMIT_W_BAL_PCT && (c.wBalChange1MinKj ?? 0) < 0 && (isRival || (r.pos != null && now.pos != null && r.pos < now.pos))) {
      moments.push({
        id: `limit-${r.name}`,
        text: `${r.name}${r.pos ? ` (P${r.pos})` : ""} is on the limit: W′ down to ${c.wBalPct}% and still falling, ${c.pctFtpLastMinute ?? "?"}% of FTP over the last minute.`,
      });
    }
  }

  // A climb or sprint coming up: the time to plan for it, before it starts.
  // Called once each time round (the id is the segment and roughly where it starts).
  const upcoming = log.courseAhead?.next.find((n) => n.kind !== "segment" && n.inKm <= SEGMENT_WARNING_KM);
  if (upcoming) {
    const startsAt = Math.round(((now.dist ?? 0) + upcoming.inKm * 1000) / 2000);
    const what = upcoming.kind === "climb" ? `${upcoming.lengthKm} km at ${upcoming.avgPct}%` : `${Math.round(upcoming.lengthKm * 1000)} m`;
    moments.push({ id: `upcoming@${upcoming.name}-${startsAt}`, text: `${upcoming.name} (${upcoming.kind}) starts in ${upcoming.inKm} km: ${what}.` });
  }

  for (const e of log.events) {
    if (e.t <= sinceT || !MOMENT_EVENTS.has(e.kind)) continue;
    if (e.kind === "distance" && !TACTIC_MARKERS.test(e.text)) continue;
    // A rival's power-up is a decision (chase the Feather or let it burn out); the rider's own isn't news to them.
    if (e.kind === "powerup" && log.rider && e.text.startsWith(log.rider.name)) continue;
    // A split with the rider behind: say how big the gap and the groups are.
    if (e.kind === "split" && ahead && ahead.gapSec <= CLOSE_GAP_SEC) {
      const b = bridgeTarget(ahead.gapSec, ahead.speedKmh, now);
      moments.push({
        id: `${e.kind}@${e.t}`,
        text: `${e.text}. Wrong side of it: the front group (${ahead.riders} riders) is ${ahead.gapSec.toFixed(1)}s up.` + (b ? ` About ${b.roughWatts} W for 30s closes it.` : ""),
      });
      continue;
    }
    moments.push({ id: `${e.kind}@${e.t}`, text: e.text });
  }
  // A gap opening just in front is the sharper read of the same thing as the group ahead slipping away.
  if (moments.some((m) => m.id === "gap-opening")) return moments.filter((m) => m.id !== "slipping");
  return moments;
}

/**
 * What the commentator or coach sees: where the race is now, the last
 * minute in brief, the groups on the road, what has happened since the last
 * line, and the last few lines said so it doesn't repeat itself. Tactics
 * also gets the rider's effort against FTP, how hard they're working
 * compared with their group, and which way the gaps either side are going.
 */
export function buildSnapshot(
  log: RaceLog,
  sinceT: number,
  mode: RadioMode = "commentary",
  moments: KeyMoment[] = [],
  nameStyle: NameStyle = "surname",
  /** The athlete's own fitness - pass it only while they're the one riding. */
  yourFitness?: RiderFitness,
) {
  const samples = log.samples;
  const now: RaceSample | undefined = samples.at(-1);
  const elapsed = now?.t ?? 0;
  const windowed = samples.filter((s) => s.t >= elapsed - WINDOW_MS);
  const first = windowed[0];
  const groups = log.groups.at(-1)?.groups ?? [];
  const lineKind = LINE_KIND[mode];
  const lines = log.events.filter((e) => e.kind === lineKind);
  const others = log.events.filter((e) => e.kind !== "commentary" && e.kind !== "tactic" && e.kind !== "start");

  const climb = first?.alt != null && now?.alt != null ? Math.round(now.alt - first.alt) : undefined;
  const base = {
    rider: log.rider
      ? {
          name: log.rider.name,
          // What to call them on air - see NameStyle.
          callName: callName(log.rider, nameStyle),
          nameStyle,
          ftp: log.rider.ftp,
          weightKg: log.rider.weight,
          profile: log.rider.profile,
          team: log.rider.team,
        }
      : undefined,
    yourFitness,
    // "pen" until the race starts: nothing on the road means anything yet.
    phase: racePhase(log),
    event: log.event && {
      ...log.event,
      startsAt: undefined,
      startsInSec: log.event.startsAt != null ? Math.round((log.event.startsAt - Date.now()) / 1000) : undefined,
    },
    elapsedSec: Math.round(elapsed / 1000),
    toGo:
      now?.remaining != null
        ? log.remainingMetric === "time"
          ? { seconds: Math.max(0, Math.round(now.remaining)) }
          : { km: Math.max(0, Math.round(now.remaining / 100) / 10) }
        : undefined,
    now: now && {
      power: now.power,
      heartRate: now.hr,
      cadence: now.cadence,
      speedKmh: now.speed,
      gradientPct: now.grade,
      draft: now.draft,
      position: now.pos,
      of: now.of,
      wBalKj: now.wBal != null ? Math.round(now.wBal / 100) / 10 : undefined,
      powerUp: now.powerUp,
    },
    lastMinute: windowed.length
      ? {
          avgPower: avg(windowed.map((s) => s.power)),
          maxPower: Math.max(...windowed.map((s) => s.power ?? 0)) || undefined,
          avgSpeedKmh: avg(windowed.map((s) => s.speed)),
          avgDraft: avg(windowed.map((s) => s.draft)),
          positionChange: first?.pos != null && now?.pos != null ? first.pos - now.pos : undefined,
          climbedM: climb,
        }
      : undefined,
    // The road ahead: the next climbs and sprints, and the next five kilometres.
    courseAhead: log.courseAhead,
    // The other riders, by name: the rider's group and the groups either side.
    field: log.field && {
      ridersGroup: log.field.ridersGroup,
      groupAhead: log.field.groupAhead,
      groupBehind: log.field.groupBehind,
      leader: log.field.leader,
      toWatch: log.field.toWatch,
      pen: log.field.pen,
      rivals: log.field.rivals,
      // Who's suffering and who's fresh, from the riders in sight.
      condition: fieldCondition(log),
    },
    groups: groups.map((g) => ({
      gapSec: g.gap,
      riders: g.size,
      avgPower: g.power,
      speedKmh: g.speed,
      ridersGroup: g.watching || undefined,
    })),
    newEvents: others.filter((e) => e.t > sinceT).slice(-RECENT_EVENTS).map(eventLine),
    // What's happening on the road right now, read from the numbers.
    whatsHappening: mode === "commentary" && moments.length ? moments.map((m) => m.text) : undefined,
    recentEvents: others.filter((e) => e.t <= sinceT).slice(-RECENT_EVENTS).map(eventLine),
    recentLines: lines.slice(-RECENT_LINES).map((e) => e.text),
    secondsSinceLastLine: lines.length ? Math.round((elapsed - lines[lines.length - 1].t) / 1000) : undefined,
  };
  if (mode === "commentary") return base;

  const ftp = log.rider?.ftp;
  const pct = (w: number | undefined) => (ftp && w != null ? Math.round((w / ftp) * 100) : undefined);
  const effortWindow = samples.filter((s) => s.t >= elapsed - EFFORT_WINDOW_MS);
  const ownGroup = groups.find((g) => g.watching);
  return {
    ...base,
    effort: {
      pctFtpNow: pct(now?.power),
      pctFtpLastMinute: pct(base.lastMinute?.avgPower),
      avgPowerLast5Min: avg(effortWindow.map((s) => s.power)),
      pctFtpLast5Min: pct(avg(effortWindow.map((s) => s.power))),
    },
    ridersGroup: ownGroup && {
      riders: ownGroup.size,
      avgPower: ownGroup.power,
      // Positive means the rider is putting out more than the group average.
      riderVsGroupWatts: now?.power != null && ownGroup.power != null ? now.power - ownGroup.power : undefined,
    },
    groupAhead: neighbour(log, "ahead"),
    groupBehind: neighbour(log, "behind"),
    teammates: teammates(log),
    // What the coach is being asked to call; everything else is context.
    keyMoments: moments.map((m) => m.text),
  };
}

/**
 * The read on the riders in sight: the ones deepest into their W′ (the
 * vulnerable), the freshest (the dangerous), and how the rider's own group
 * is doing overall.
 */
function fieldCondition(log: RaceLog) {
  const f = log.field;
  if (!f) return undefined;
  const everyone = [
    ...f.ridersGroup.map((r) => ({ ...r, where: "rider's group" })),
    ...(f.groupAhead ?? []).map((r) => ({ ...r, where: "group ahead" })),
    ...(f.groupBehind ?? []).map((r) => ({ ...r, where: "group behind" })),
  ].filter((r) => r.condition?.wBalPct != null && r.name !== log.rider?.name);
  if (!everyone.length) return undefined;
  const brief = (r: (typeof everyone)[number]) => ({
    name: r.name,
    where: r.where,
    wBalPct: r.condition?.wBalPct,
    wBalChange1MinKj: r.condition?.wBalChange1MinKj,
    pctFtpLastMinute: r.condition?.pctFtpLastMinute,
    state: r.condition?.state,
  });
  const byTank = everyone.slice().sort((a, b) => (a.condition?.wBalPct ?? 0) - (b.condition?.wBalPct ?? 0));
  const own = f.ridersGroup.map((r) => r.condition?.wBalPct).filter((v): v is number => v != null);
  return {
    deepest: byTank.slice(0, 3).filter((r) => (r.condition?.wBalPct ?? 100) < 60).map(brief),
    freshest: byTank.slice(-3).reverse().filter((r) => (r.condition?.wBalPct ?? 0) >= 80).map(brief),
    ridersGroupAvgWBalPct: own.length ? Math.round(own.reduce((a, b) => a + b, 0) / own.length) : undefined,
    ridersGroupOnTheLimit: f.ridersGroup.filter((r) => r.condition?.state === "on the limit" || r.condition?.state === "empty").length,
  };
}

/** Riders in sight wearing the rider's team tag, and where they are relative to the rider. */
function teammates(log: RaceLog) {
  const team = log.rider?.team?.toLowerCase();
  const f = log.field;
  if (!team || !f) return undefined;
  const where = [
    ["in your group", f.ridersGroup],
    ["in the group ahead", f.groupAhead ?? []],
    ["in the group behind", f.groupBehind ?? []],
  ] as const;
  const found = where.flatMap(([place, riders]) =>
    riders.filter((r) => r.team?.toLowerCase() === team && r.name !== log.rider?.name).map((r) => ({ name: r.name, where: place, gap: r.gap })),
  );
  return found.length ? found : undefined;
}

/**
 * The athlete's own fitness going into the race, from /api/race-fitness:
 * fitness, fatigue and form, Garmin readiness, sleep and HRV, and what's
 * already been ridden today. Only ever about the athlete at this computer,
 * so it's only given to the commentator and coach while they're the one
 * riding.
 */
export type RiderFitness = Record<string, string | number | null>;

export async function fetchRiderFitness(apiBase: string, token: string | null): Promise<RiderFitness> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${apiBase}/api/race-fitness`, { headers, credentials: apiBase ? "omit" : "same-origin" });
  if (!res.ok) throw new Error(`Fitness unavailable (${res.status})`);
  return (await res.json()) as RiderFitness;
}

export async function requestCommentary(
  apiBase: string,
  token: string | null,
  snapshot: ReturnType<typeof buildSnapshot>,
  mode: RadioMode = "commentary",
): Promise<string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${apiBase}/api/race-commentary`, {
    method: "POST",
    headers,
    // The site uses its session cookie; the mod, on another origin, its key.
    credentials: apiBase ? "omit" : "same-origin",
    body: JSON.stringify({ context: snapshot, mode }),
  });
  if (res.status === 401) throw new Error(token ? "The commentary key was refused - get a new one." : "Signed out.");
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error && res.status === 502 ? body.error : `${mode === "tactics" ? "Tactics" : "Commentary"} failed (${res.status}).`);
  }
  const body = (await res.json()) as { text?: string };
  return body.text?.trim() ?? "";
}

/**
 * How natural a voice sounds, best first. The browser's speech comes from
 * whatever the system has: Edge on Windows offers Microsoft's neural
 * "Online (Natural)" voices, Chrome its "Google" voices, and the older
 * Windows desktop voices sound robotic. British and Irish English suit the
 * commentary best.
 */
function voiceScore(v: SpeechSynthesisVoice): number {
  if (!/^en/i.test(v.lang)) return -1;
  let score = 0;
  if (/natural|neural/i.test(v.name)) score += 100;
  else if (/online/i.test(v.name)) score += 60;
  else if (/^google/i.test(v.name)) score += 40;
  if (/en[-_](GB|IE)/i.test(v.lang)) score += 10;
  if (!v.localService) score += 5;
  return score;
}

export function englishVoices(): SpeechSynthesisVoice[] {
  try {
    return (window.speechSynthesis?.getVoices() ?? [])
      .filter((v) => voiceScore(v) >= 0)
      .sort((a, b) => voiceScore(b) - voiceScore(a) || a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/** True when the best voice on offer is one of the robotic desktop ones. */
export function onlyBasicVoices(voices: SpeechSynthesisVoice[]): boolean {
  return voices.length > 0 && voiceScore(voices[0]) < 40;
}

// Commentary and tactics can run at once - in one page on the site, or as
// the console and the tactics overlay in Sauce - so their voices take
// turns. The coach has right of way: when a call starts, the commentator
// stops mid-sentence and waits, as on a real broadcast. Windows on the same
// origin (both Sauce windows) hear about it over a BroadcastChannel; a page
// running both handles it directly.

/** What each radio is saying right now, in this window. */
const playing: Record<RadioMode, HTMLAudioElement | "synth" | null> = { commentary: null, tactics: null };
/** Until when the coach is on air in another window. */
let coachElsewhereUntil = 0;
/** Longest a call can hold the commentator off if its "done" never arrives. */
const COACH_HOLD_MS = 20_000;

const bus: BroadcastChannel | null = (() => {
  try {
    return typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("ultracyclist-race-radio");
  } catch {
    return null;
  }
})();
bus?.addEventListener("message", (e: MessageEvent<{ type?: string }>) => {
  if (e.data?.type === "coach-start") {
    coachElsewhereUntil = Date.now() + COACH_HOLD_MS;
    stopSpeaking("commentary");
  } else if (e.data?.type === "coach-end") {
    coachElsewhereUntil = 0;
  }
});

function coachOnAir() {
  stopSpeaking("commentary");
  bus?.postMessage({ type: "coach-start" });
}

function coachOffAir() {
  bus?.postMessage({ type: "coach-end" });
}

function coachTalking(): boolean {
  return Date.now() < coachElsewhereUntil || isSpeaking("tactics");
}

/** Reads a line aloud with the browser's voice, cutting off this radio's last line. */
export function speak(text: string, voiceName?: string | null, mode: RadioMode = "commentary") {
  // The commentator gives way to the coach; the line is still on screen.
  if (mode === "commentary" && coachTalking()) return;
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    stopSpeaking(mode);
    // The browser has one speech queue per page, so a coach call clears it.
    if (mode === "tactics") {
      coachOnAir();
      synth.cancel();
    }
    const u = new SpeechSynthesisUtterance(text);
    const voices = englishVoices();
    u.voice = voices.find((v) => v.name === voiceName) ?? voices[0] ?? null;
    const done = () => {
      if (playing[mode] === "synth") playing[mode] = null;
      if (mode === "tactics") coachOffAir();
    };
    u.addEventListener("end", done);
    u.addEventListener("error", done);
    playing[mode] = "synth";
    synth.speak(u);
  } catch {
    // No speech on this browser - the line is still on screen.
  }
}

/**
 * OpenAI's voices (api/_routes/race-voice.ts keeps the same list). Ash is
 * the commentator's default, low and warm; Sage the coach's, so the two
 * are easy to tell apart.
 */
export const NATURAL_VOICES = ["ash", "ballad", "cedar", "coral", "echo", "fable", "marin", "onyx", "nova", "sage", "shimmer", "verse", "alloy"];
export const DEFAULT_NATURAL_VOICE: Record<RadioMode, string> = { commentary: "ash", tactics: "sage" };

export class VoiceUnavailableError extends Error {
  readonly notConfigured: boolean;

  constructor(message: string, notConfigured = false) {
    super(message);
    this.notConfigured = notConfigured;
  }
}

/**
 * Speaks a line with OpenAI's text-to-speech via /api/race-voice. Resolves
 * once it starts playing; throws VoiceUnavailableError so the caller can
 * fall back to the browser's voice.
 */
export async function speakNatural(
  apiBase: string,
  token: string | null,
  text: string,
  voice: string,
  mode: RadioMode = "commentary",
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${apiBase}/api/race-voice`, {
    method: "POST",
    headers,
    credentials: apiBase ? "omit" : "same-origin",
    body: JSON.stringify({ text, voice, mode }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
    throw new VoiceUnavailableError(
      body.error && res.status === 502 ? body.error : `Natural voice failed (${res.status}).`,
      body.code === "not-configured",
    );
  }
  const url = URL.createObjectURL(await res.blob());
  // The coach may have come on while this line was being voiced.
  if (mode === "commentary" && coachTalking()) {
    URL.revokeObjectURL(url);
    return;
  }
  stopSpeaking(mode);
  if (mode === "tactics") coachOnAir();
  const audio = new Audio(url);
  const done = () => {
    URL.revokeObjectURL(url);
    if (playing[mode] === audio) playing[mode] = null;
    if (mode === "tactics") coachOffAir();
  };
  audio.addEventListener("ended", done, { once: true });
  audio.addEventListener("pause", done, { once: true });
  playing[mode] = audio;
  try {
    await audio.play();
  } catch {
    done();
    throw new VoiceUnavailableError("The browser blocked the audio - click anywhere on the page and it'll play.");
  }
}

/** Stops one radio's voice, or both. */
export function stopSpeaking(mode?: RadioMode) {
  for (const m of mode ? [mode] : (["commentary", "tactics"] as const)) {
    const p = playing[m];
    playing[m] = null;
    if (p instanceof HTMLAudioElement) {
      p.pause();
    } else if (p === "synth") {
      try {
        window.speechSynthesis?.cancel();
      } catch {
        // Nothing to stop.
      }
    }
  }
}

/** Whether this radio is mid-line - for commentary, including the coach talking over it. */
export function isSpeaking(mode: RadioMode = "commentary"): boolean {
  const p = playing[mode];
  if (p instanceof HTMLAudioElement && !p.paused && !p.ended) return true;
  if (p === "synth") {
    try {
      if (window.speechSynthesis?.speaking) return true;
    } catch {
      // Treat as silent.
    }
  }
  return mode === "commentary" && coachTalking();
}
