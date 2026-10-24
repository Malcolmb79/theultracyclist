import type { RaceEvent, RaceLog, RaceSample } from "./raceLog";

// Live commentary: a compact snapshot of the race goes to
// /api/race-commentary, one or two sentences come back, and the browser's
// own speech synthesis reads them out. See api/_routes/race-commentary.ts
// for what the model is told the snapshot means.

/** A line when nothing has happened, so the broadcast never goes quiet. */
export const COMMENTARY_EVERY_MS = 25_000;
/** And no more often than this, however busy the race gets. */
export const COMMENTARY_MIN_GAP_MS = 10_000;
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

/**
 * What the commentator sees: where the race is now, the last minute in
 * brief, the groups on the road, what has happened since the last line, and
 * the last few lines said so it doesn't repeat itself.
 */
export function buildSnapshot(log: RaceLog, sinceT: number) {
  const samples = log.samples;
  const now: RaceSample | undefined = samples.at(-1);
  const elapsed = now?.t ?? 0;
  const windowed = samples.filter((s) => s.t >= elapsed - WINDOW_MS);
  const first = windowed[0];
  const groups = log.groups.at(-1)?.groups ?? [];
  const commentary = log.events.filter((e) => e.kind === "commentary");
  const others = log.events.filter((e) => e.kind !== "commentary" && e.kind !== "start");

  const climb = first?.alt != null && now?.alt != null ? Math.round(now.alt - first.alt) : undefined;
  return {
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
    recentCommentary: commentary.slice(-RECENT_LINES).map((e) => e.text),
  };
}

export async function requestCommentary(
  apiBase: string,
  token: string | null,
  snapshot: ReturnType<typeof buildSnapshot>,
): Promise<string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${apiBase}/api/race-commentary`, {
    method: "POST",
    headers,
    // The site uses its session cookie; the mod, on another origin, its key.
    credentials: apiBase ? "omit" : "same-origin",
    body: JSON.stringify({ context: snapshot }),
  });
  if (res.status === 401) throw new Error(token ? "The commentary key was refused - get a new one." : "Signed out.");
  if (!res.ok) throw new Error(`Commentary failed (${res.status}).`);
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

/** Reads a line aloud, cutting off anything still being said. */
export function speak(text: string, voiceName?: string | null) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voices = englishVoices();
    u.voice = voices.find((v) => v.name === voiceName) ?? voices[0] ?? null;
    synth.speak(u);
  } catch {
    // No speech on this browser - the line is still on screen.
  }
}

/**
 * OpenAI's voices (api/_routes/race-voice.ts keeps the same list). Ash is
 * the default: low and warm, which suits a commentary box.
 */
export const NATURAL_VOICES = ["ash", "ballad", "cedar", "coral", "echo", "fable", "marin", "onyx", "nova", "sage", "shimmer", "verse", "alloy"];

let natural: HTMLAudioElement | null = null;

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
export async function speakNatural(apiBase: string, token: string | null, text: string, voice: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${apiBase}/api/race-voice`, {
    method: "POST",
    headers,
    credentials: apiBase ? "omit" : "same-origin",
    body: JSON.stringify({ text, voice }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { code?: string };
    throw new VoiceUnavailableError(`Natural voice failed (${res.status}).`, body.code === "not-configured");
  }
  const url = URL.createObjectURL(await res.blob());
  stopSpeaking();
  const audio = new Audio(url);
  audio.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
  natural = audio;
  try {
    await audio.play();
  } catch {
    URL.revokeObjectURL(url);
    throw new VoiceUnavailableError("The browser blocked the audio - click anywhere on the page and it'll play.");
  }
}

export function stopSpeaking() {
  if (natural) {
    natural.pause();
    natural = null;
  }
  try {
    window.speechSynthesis?.cancel();
  } catch {
    // Nothing to stop.
  }
}

export function isSpeaking(): boolean {
  if (natural && !natural.paused && !natural.ended) return true;
  try {
    return !!window.speechSynthesis?.speaking;
  } catch {
    return false;
  }
}
