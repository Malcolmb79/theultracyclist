import type { GroupSummary, RaceEvent, RaceLog, RaceSample } from "./raceLog";

// Live commentary and tactics: a compact snapshot of the race goes to
// /api/race-commentary, a line comes back, and it's read aloud. Commentary
// talks about the rider like a broadcaster; tactics talks to them like a
// coach on the radio. See api/_routes/race-commentary.ts for what the model
// is told the snapshot means.

export type RadioMode = "commentary" | "tactics";

/**
 * How often each mode speaks. Commentary keeps a steady flow so the
 * broadcast never goes quiet; the coach checks in often but may decide
 * there's nothing worth saying, and cuts in sooner when the race changes.
 */
export const RADIO_TIMING: Record<RadioMode, { everyMs: number; minGapMs: number }> = {
  commentary: { everyMs: 25_000, minGapMs: 10_000 },
  tactics: { everyMs: 20_000, minGapMs: 8_000 },
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
const CLOSE_GAP_SEC = 6;
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
  };
}

/**
 * The things a coach would cut in for straight away, worked out from the
 * numbers rather than left to the model to notice: the tank running dry,
 * a gap you can close, a group closing on you.
 */
function tacticalAlerts(log: RaceLog) {
  const now = log.samples.at(-1);
  const alerts: string[] = [];
  if (now?.wBal != null && now.wBal < LOW_WBAL_J) alerts.push("anaerobic reserve nearly empty");
  const ahead = neighbour(log, "ahead");
  if (ahead && ahead.gapSec <= CLOSE_GAP_SEC && (ahead.gapChange30s ?? 0) < 0) alerts.push("closing on the group ahead");
  if (ahead && ahead.gapSec <= CLOSE_GAP_SEC && (ahead.gapChange30s ?? 0) > 1) alerts.push("group ahead pulling away");
  const behind = neighbour(log, "behind");
  if (behind && behind.gapSec <= CLOSE_GAP_SEC && (behind.gapChange30s ?? 0) < 0) alerts.push("group behind closing in");
  return alerts;
}

/** A fingerprint of the current alerts, so a new one can cut in early. */
export function alertKey(log: RaceLog): string {
  return tacticalAlerts(log).join("|");
}

/**
 * What the commentator or coach sees: where the race is now, the last
 * minute in brief, the groups on the road, what has happened since the last
 * line, and the last few lines said so it doesn't repeat itself. Tactics
 * also gets the rider's effort against FTP, how hard they're working
 * compared with their group, and which way the gaps either side are going.
 */
export function buildSnapshot(log: RaceLog, sinceT: number, mode: RadioMode = "commentary") {
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
    alerts: tacticalAlerts(log),
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
