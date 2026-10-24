import type { EventBrief, GroupSummary, RaceEvent, RaceLog, RaceSample } from "./raceLog";

// Live commentary and tactics: a compact snapshot of the race goes to
// /api/race-commentary, a line comes back, and it's read aloud. Commentary
// talks about the rider like a broadcaster; tactics talks to them like a
// coach on the radio. See api/_routes/race-commentary.ts for what the model
// is told the snapshot means.

export type RadioMode = "commentary" | "tactics";

/**
 * How often each mode speaks. Commentary keeps a steady flow so the
 * broadcast never goes quiet. The coach never speaks on a timer: only when
 * there's a new key moment (see keyMoments), and not more often than this.
 */
export const RADIO_TIMING: Record<RadioMode, { everyMs: number; minGapMs: number }> = {
  commentary: { everyMs: 25_000, minGapMs: 10_000 },
  tactics: { everyMs: Infinity, minGapMs: 6_000 },
};
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
const TOWING_WATTS = 40;
/** The road tipping up: from under 2% to at least this. */
const CLIMB_PCT = 4;
/**
 * How long a moment stays said before the same one can be called again.
 * Moments whose id carries "@" (an event, a pen briefing) are called once.
 */
export const MOMENT_COOLDOWN_MS = 45_000;
/** Race events that are key moments for the coach in their own right. */
const MOMENT_EVENTS = new Set<RaceEvent["kind"]>(["split", "merge", "distance", "position", "go"]);
/** Countdown calls in the pen, seconds before the start - the last one just before the off. */
const COUNTDOWN_CALLS_SEC = [120, 60, 15];
/** Moments worth cutting in for, rather than waiting for the next line. */
const NEWSWORTHY = new Set<RaceEvent["kind"]>(["position", "split", "merge", "surge", "powerup", "distance", "watching"]);
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

export function isNewsworthy(e: RaceEvent): boolean {
  return NEWSWORTHY.has(e.kind);
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
export function keyMoments(log: RaceLog, sinceT: number, clock = Date.now()): KeyMoment[] {
  const moments: KeyMoment[] = [];
  const samples = log.samples;
  const now = samples.at(-1);
  if (!now) return moments;

  // In the start pen nothing on the road means anything yet: the coach
  // briefs the race once, then counts down to the start.
  // Ids carrying "@" are one-off: called once for this pen, never again.
  if (now.pen) {
    const ev = log.event;
    const penT = log.events.findLast((e) => e.kind === "pen")?.t ?? 0;
    const startsIn = ev?.startsAt != null ? Math.round((ev.startsAt - clock) / 1000) : undefined;
    // Give Sauce a few seconds to look the event up before briefing without it.
    if (ev || now.t - penT > 10_000) {
      moments.push({
        id: `briefing@${penT}`,
        text: `In the start pen. ${describeEvent(ev, now.of)}${startsIn != null && startsIn > 0 ? ` Starts in ${formatWait(startsIn)}.` : ""}`,
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
    const recent = samples.filter((s) => s.t >= now.t - 20_000);
    const mine = avg(recent.map((s) => s.power));
    if (recent.length >= 15 && mine != null && mine - own.power >= TOWING_WATTS) {
      moments.push({
        id: "towing",
        text: `You've averaged ${mine} W for 20s, ${Math.round(mine - own.power)} W more than your group of ${own.size} (${Math.round(own.power)} W).`,
      });
    }
  }

  const gradeNow = avg(samples.filter((s) => s.t >= now.t - 10_000).map((s) => s.grade));
  const gradeBefore = avg(samples.filter((s) => s.t >= now.t - 40_000 && s.t < now.t - 20_000).map((s) => s.grade));
  if (gradeNow != null && gradeBefore != null && gradeNow >= CLIMB_PCT && gradeBefore < 2) {
    moments.push({ id: "climb", text: `The road has kicked up to ${gradeNow}% (from ${gradeBefore}%).` });
  }

  if (now.wBal != null && now.wBal < LOW_WBAL_J) {
    moments.push({ id: "tank", text: `Anaerobic reserve is down to ${(now.wBal / 1000).toFixed(1)} kJ.` });
  }

  for (const e of log.events) {
    if (e.t > sinceT && MOMENT_EVENTS.has(e.kind)) moments.push({ id: `${e.kind}@${e.t}`, text: e.text });
  }
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
    rider: log.rider ? { name: log.rider.name, ftp: log.rider.ftp, weightKg: log.rider.weight } : undefined,
    // "pen" until the race starts: nothing on the road means anything yet.
    phase: now?.pen ? ("pen" as const) : ("racing" as const),
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
    groups: groups.map((g) => ({
      gapSec: g.gap,
      riders: g.size,
      avgPower: g.power,
      speedKmh: g.speed,
      ridersGroup: g.watching || undefined,
    })),
    newEvents: others.filter((e) => e.t > sinceT).slice(-RECENT_EVENTS).map(eventLine),
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
    // What the coach is being asked to call; everything else is context.
    keyMoments: moments.map((m) => m.text),
  };
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
