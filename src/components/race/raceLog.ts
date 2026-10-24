import { athleteName, type SauceAthleteData, type SauceChat, type SauceGroup } from "./sauceFeed";

// A race as a timestamped record: a one-second trace of the watched rider,
// a summary of the groups on the road every few seconds, and the moments
// worth talking about (moves through the field, splits, surges, chat).
// It is what the race review reads afterwards and what live commentary and
// tactics will read as the race goes, so it holds numbers rather than prose
// and every entry carries `t`, milliseconds since recording started.

export const RACE_LOG_VERSION = 1;

export interface RaceSample {
  t: number;
  power?: number;
  hr?: number;
  cadence?: number;
  /** km/h */
  speed?: number;
  /** Metres into the event, or ridden this session outside one. */
  dist?: number;
  alt?: number;
  /** Percent. */
  grade?: number;
  draft?: number;
  pos?: number;
  of?: number;
  /** Metres or seconds to the finish, per the log's remainingMetric. */
  remaining?: number;
  /** Joules. */
  wBal?: number;
  powerUp?: string;
}

export interface GroupSummary {
  /** Seconds to the watched rider's group; negative is ahead. */
  gap: number;
  size: number;
  power?: number;
  speed?: number;
  watching?: boolean;
}

export interface GroupSnapshot {
  t: number;
  groups: GroupSummary[];
}

export type RaceEventKind =
  | "start"
  | "watching"
  | "position"
  | "split"
  | "merge"
  | "surge"
  | "powerup"
  | "distance"
  | "chat"
  | "commentary"
  | "tactic"
  | "stop";

export interface RaceEvent {
  t: number;
  kind: RaceEventKind;
  text: string;
}

export interface RaceLog {
  version: typeof RACE_LOG_VERSION;
  id: string;
  startedAt: string;
  endedAt?: string;
  rider?: { athleteId: number; name: string; ftp?: number; weight?: number };
  eventSubgroupId?: number;
  remainingMetric?: "time" | "distance";
  samples: RaceSample[];
  groups: GroupSnapshot[];
  events: RaceEvent[];
}

const SAMPLE_EVERY_MS = 1000;
const GROUPS_EVERY_MS = 5000;
/** Groups furthest from the watched rider matter least; keep the log lean. */
const MAX_GROUPS = 8;
/** Places gained or lost before a move counts as one. */
const POSITION_STEP = 3;
/** A surge is this multiple of FTP held for SURGE_SECONDS. */
const SURGE_FTP = 1.5;
const SURGE_SECONDS = 5;
/** Nearest first, so the marker just crossed is the first one that matches. */
const DISTANCE_MARKERS_M = [500, 1000, 2000, 5000, 10_000, 20_000];

function round(n: number | undefined, dp = 0): number | undefined {
  if (n == null || !Number.isFinite(n)) return undefined;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

function formatDistance(m: number): string {
  return m >= 1000 ? `${round(m / 1000, 1)} km` : `${Math.round(m)} m`;
}

export class RaceRecorder {
  readonly log: RaceLog;
  private readonly start: number;
  private lastSampleAt = -Infinity;
  private lastGroupsAt = -Infinity;
  private reportedPosition: number | undefined;
  private watchedGroupSize: number | undefined;
  private surgeSeconds = 0;
  private inSurge = false;
  private lastPowerUp: string | undefined;
  private passedMarkers = new Set<number>();

  constructor(now = Date.now()) {
    this.start = now;
    this.log = {
      version: RACE_LOG_VERSION,
      id: `race_${now}`,
      startedAt: new Date(now).toISOString(),
      samples: [],
      groups: [],
      events: [],
    };
    this.event("start", "Recording started", now);
  }

  private at(now: number): number {
    return now - this.start;
  }

  private event(kind: RaceEventKind, text: string, now: number) {
    this.log.events.push({ t: this.at(now), kind, text });
  }

  watching(data: SauceAthleteData, now = Date.now()) {
    const rider = this.log.rider;
    if (!rider || rider.athleteId !== data.athleteId) {
      const name = athleteName(data);
      this.log.rider = {
        athleteId: data.athleteId,
        name,
        ftp: data.athlete?.ftp ?? undefined,
        weight: round(data.athlete?.weight, 1),
      };
      if (rider) {
        this.event("watching", `Now following ${name}`, now);
        // Positions, groups and surges belong to whoever was being watched.
        this.reportedPosition = undefined;
        this.watchedGroupSize = undefined;
        this.surgeSeconds = 0;
        this.inSurge = false;
      }
    }
    if (data.state?.eventSubgroupId) this.log.eventSubgroupId = data.state.eventSubgroupId;
    if (data.remainingMetric) this.log.remainingMetric = data.remainingMetric;

    if (now - this.lastSampleAt < SAMPLE_EVERY_MS) return;
    this.lastSampleAt = now;

    const s = data.state ?? {};
    const sample: RaceSample = {
      t: this.at(now),
      power: round(s.power),
      hr: round(s.heartrate) || undefined,
      cadence: round(s.cadence) || undefined,
      speed: round(s.speed, 1),
      dist: round(s.eventDistance || s.distance),
      alt: round(s.altitude, 1),
      grade: round(s.grade != null ? s.grade * 100 : undefined, 1),
      draft: round(s.draft),
      pos: data.eventPosition || undefined,
      of: data.eventParticipants || undefined,
      remaining: round(data.remaining),
      wBal: round(data.wBal),
      powerUp: s.activePowerUp || undefined,
    };
    this.log.samples.push(sample);
    this.detect(data, sample, now);
  }

  private detect(data: SauceAthleteData, sample: RaceSample, now: number) {
    const name = this.log.rider?.name ?? "The rider";

    if (sample.pos) {
      if (this.reportedPosition == null) {
        this.reportedPosition = sample.pos;
        this.event("position", `${name} is ${ordinal(sample.pos)}${sample.of ? ` of ${sample.of}` : ""}`, now);
      } else if (Math.abs(sample.pos - this.reportedPosition) >= POSITION_STEP) {
        const up = sample.pos < this.reportedPosition;
        this.event(
          "position",
          `${name} ${up ? "moves up" : "drops back"} from ${ordinal(this.reportedPosition)} to ${ordinal(sample.pos)}`,
          now,
        );
        this.reportedPosition = sample.pos;
      }
    }

    const ftp = this.log.rider?.ftp;
    if (ftp && sample.power != null) {
      this.surgeSeconds = sample.power >= ftp * SURGE_FTP ? this.surgeSeconds + 1 : 0;
      if (this.surgeSeconds >= SURGE_SECONDS && !this.inSurge) {
        this.inSurge = true;
        this.event("surge", `${name} surges at ${sample.power} W (${round(sample.power / ftp, 1)}× FTP)`, now);
      } else if (this.surgeSeconds === 0) {
        this.inSurge = false;
      }
    }

    if (sample.powerUp && sample.powerUp !== this.lastPowerUp) {
      this.event("powerup", `${name} uses a ${sample.powerUp.toLowerCase().replace(/_/g, " ")} power-up`, now);
    }
    this.lastPowerUp = sample.powerUp;

    if (data.remainingMetric === "distance" && sample.remaining != null && sample.remaining > 0) {
      for (const marker of DISTANCE_MARKERS_M) {
        if (sample.remaining <= marker && !this.passedMarkers.has(marker)) {
          // Mark every marker already behind us, so joining a race late
          // announces only the nearest one rather than all of them at once.
          for (const m of DISTANCE_MARKERS_M) if (m >= marker) this.passedMarkers.add(m);
          this.event("distance", `${formatDistance(marker)} to go`, now);
          break;
        }
      }
    }
  }

  groups(groups: SauceGroup[], now = Date.now()) {
    const watchedIdx = groups.findIndex((g) => g.watching);
    if (watchedIdx >= 0) {
      const size = groups[watchedIdx].athletes?.length ?? 0;
      const prev = this.watchedGroupSize;
      const name = this.log.rider?.name ?? "The rider";
      if (prev == null || Math.abs(size - prev) < 3) {
        // Riders come and go one at a time all race; follow that drift.
        this.watchedGroupSize = size;
      } else if (size > 0 && size <= prev * 0.75) {
        this.event("split", `The group splits: ${name} is now in a group of ${size} (was ${prev})`, now);
        this.watchedGroupSize = size;
      } else if (size >= prev * 1.25) {
        this.event("merge", `Groups come together: ${name}'s group grows to ${size} (was ${prev})`, now);
        this.watchedGroupSize = size;
      }
      // A bigger change short of those ratios keeps the old size, so if it
      // carries on it is measured against where the group started.
    }

    if (now - this.lastGroupsAt < GROUPS_EVERY_MS) return;
    this.lastGroupsAt = now;
    const from = Math.max(0, (watchedIdx >= 0 ? watchedIdx : 0) - Math.floor(MAX_GROUPS / 2));
    this.log.groups.push({
      t: this.at(now),
      groups: groups.slice(from, from + MAX_GROUPS).map((g) => ({
        gap: round(g.gap, 1) ?? 0,
        size: g.athletes?.length ?? 0,
        power: round(g.power),
        speed: round(g.speed, 1),
        watching: g.watching || undefined,
      })),
    });
  }

  /** A line of commentary or a tactical call, kept so the review can see what was said. */
  radio(kind: "commentary" | "tactic", text: string, now = Date.now()) {
    this.event(kind, text, now);
  }

  chat(chat: SauceChat, now = Date.now()) {
    const message = chat.message?.trim();
    if (!message) return;
    const name = `${chat.firstName ?? ""} ${chat.lastName ?? ""}`.trim() || "Someone";
    this.event("chat", `${name}: ${message}`, now);
  }

  stop(now = Date.now()): RaceLog {
    this.event("stop", "Recording stopped", now);
    this.log.endedAt = new Date(now).toISOString();
    return this.log;
  }
}

// Logs are kept in this browser so a refresh or crash mid-race loses
// nothing, and so the last few races are there to download afterwards.
// The race review will move them to the server.
const CURRENT_KEY = "race-log:current";
const SAVED_KEY = "race-log:saved";
/** An hour's race is roughly 0.5 MB; localStorage gives about 5 MB. */
const MAX_SAVED = 3;

function isRaceLog(v: unknown): v is RaceLog {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as RaceLog).version === RACE_LOG_VERSION &&
    Array.isArray((v as RaceLog).samples) &&
    Array.isArray((v as RaceLog).events)
  );
}

export function saveCurrentLog(log: RaceLog) {
  try {
    window.localStorage.setItem(CURRENT_KEY, JSON.stringify(log));
  } catch {
    // Full or unavailable - the download still works from memory.
  }
}

export function loadCurrentLog(): RaceLog | null {
  try {
    const raw = window.localStorage.getItem(CURRENT_KEY);
    const v: unknown = raw ? JSON.parse(raw) : null;
    return isRaceLog(v) ? v : null;
  } catch {
    return null;
  }
}

export function loadSavedLogs(): RaceLog[] {
  try {
    const raw = window.localStorage.getItem(SAVED_KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter(isRaceLog) : [];
  } catch {
    return [];
  }
}

/** Moves a finished log into the saved list, dropping the oldest. */
export function archiveLog(log: RaceLog): RaceLog[] {
  const saved = [log, ...loadSavedLogs().filter((l) => l.id !== log.id)];
  // Drop the oldest until it fits, rather than losing the race just finished.
  for (let keep = Math.min(saved.length, MAX_SAVED); keep > 0; keep--) {
    try {
      window.localStorage.setItem(SAVED_KEY, JSON.stringify(saved.slice(0, keep)));
      window.localStorage.removeItem(CURRENT_KEY);
      return saved.slice(0, keep);
    } catch {
      // Too big - try again with one fewer.
    }
  }
  return saved.slice(0, 1);
}

export function downloadLog(log: RaceLog) {
  const blob = new Blob([JSON.stringify(log, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const who = log.rider?.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() ?? "race";
  a.href = url;
  a.download = `${log.startedAt.slice(0, 16).replace(/[:T]/g, "-")}-${who}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}
