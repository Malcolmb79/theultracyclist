import { sameRaceGroups } from "./sameRace";
import { powerUp } from "./powerUps";
import { athleteName, cleanName, type SauceAthleteData, type SauceChat, type SauceGroup } from "./sauceFeed";

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
  /** The active power-up by its Zwift name: Feather, Van, Aero helmet... */
  powerUp?: string;
  /** In an event's start pen: signed in to it, not yet under way. */
  pen?: boolean;
}

/** What Sauce knows about the event being ridden, from before the start. */
export interface EventBrief {
  name?: string;
  /** The category, e.g. "A". */
  label?: string;
  /** Start time, epoch milliseconds. */
  startsAt?: number;
  distanceKm?: number;
  climbM?: number;
  laps?: number;
  durationMin?: number;
  powerUps?: boolean;
}

export interface GroupSummary {
  /** Seconds to the watched rider's group; negative is ahead. */
  gap: number;
  size: number;
  power?: number;
  speed?: number;
  watching?: boolean;
}

/** A named rider on the road, for commentary about the rest of the race. */
export interface FieldRider {
  name: string;
  team?: string;
  pos?: number;
  wkg?: number;
  power?: number;
  /** Seconds to the watched rider; negative is ahead. */
  gap?: number;
  profile?: RiderProfile;
  /** How they're doing right now: see RiderCondition. */
  condition?: RiderCondition;
}

/**
 * A rider's state in the race this moment, from what Sauce sees of them:
 * how much of their anaerobic tank (W′) is left and which way it's going,
 * and how hard they're riding against their FTP, now and over the last
 * minute - the read a team car has on who's suffering and who's fresh.
 */
export interface RiderCondition {
  /** Share of W′ left, 0-100. */
  wBalPct?: number;
  wBalKj?: number;
  /** Change in W′ over the last minute, in kJ: negative means they're digging into it. */
  wBalChange1MinKj?: number;
  pctFtpNow?: number;
  pctFtpLastMinute?: number;
  /** In words: fresh, comfortable, working, digging deep, on the limit, empty, recovering. */
  state?: string;
}

/**
 * What's known of a rider beyond this moment: Zwift's racing score and
 * category, their level, and their best efforts so far today as watts per
 * kilo - which says what kind of rider they are, and how hard they've
 * already gone.
 */
export interface RiderProfile {
  racingScore?: number;
  category?: string;
  level?: number;
  ftpWkg?: number;
  /** Not on a power meter or smart trainer: their numbers are estimates. */
  estimatedPower?: boolean;
  best5sWkg?: number;
  best15sWkg?: number;
  best1minWkg?: number;
  best5minWkg?: number;
  best20minWkg?: number;
  /** A rough read of their strengths from those best efforts. */
  type?: "sprinter" | "puncheur" | "diesel";
}

/** A rider's profile from Sauce's data, or nothing when there's nothing to go on. */
export function riderProfile(a: SauceAthleteData): RiderProfile | undefined {
  const at = a.athlete;
  const weight = at?.weight;
  const peak = (sec: number) => {
    const w = a.stats?.power?.peaks?.[String(sec)]?.avg;
    return w && weight ? round(w / weight, 1) : undefined;
  };
  const p: RiderProfile = {
    racingScore: at?.racingScore != null ? Math.round(at.racingScore) : undefined,
    category: at?.racingCategory || undefined,
    level: at?.level || undefined,
    ftpWkg: at?.ftp && weight ? round(at.ftp / weight, 1) : undefined,
    estimatedPower: at?.powerMeter === false || undefined,
    best5sWkg: peak(5),
    best15sWkg: peak(15),
    best1minWkg: peak(60),
    best5minWkg: peak(300),
    best20minWkg: peak(1200),
  };
  // Only once there's been a real effort to judge by.
  if (p.best15sWkg && p.best5minWkg && p.best5minWkg >= 3) {
    if (p.best15sWkg >= 11 && p.best15sWkg / p.best5minWkg >= 2.4) p.type = "sprinter";
    else if (p.best1minWkg && p.best1minWkg >= 7.5) p.type = "puncheur";
    else if (p.best15sWkg / p.best5minWkg < 1.9) p.type = "diesel";
  }
  return Object.values(p).some((v) => v != null) ? p : undefined;
}

/** The riders around the watched one right now: their group and the groups either side. */
/** What's coming up on the route: the next climbs and sprints, and the shape of the next few kilometres. */
export interface CourseAhead {
  /** The segment being ridden now, if any. */
  current?: { name: string; kind: string; toGoM: number; avgPct?: number };
  next: { name: string; kind: string; inKm: number; lengthKm: number; avgPct: number }[];
  next5km: { climbM: number; descentM: number; steepestPct: number };
  /** Where the finish is, when it's within the distance looked at. */
  finishInKm?: number;
}

export interface FieldSnapshot {
  t: number;
  /** The rider's own group, hardest-working first. */
  ridersGroup: FieldRider[];
  groupAhead?: FieldRider[];
  groupBehind?: FieldRider[];
  /** The race leader, when Sauce can see them. */
  leader?: FieldRider;
  /** The strongest riders around, by racing score: the ones to watch. */
  toWatch?: FieldRider[];
  /** In the start pen: who's lined up, for the commentator to talk through. */
  pen?: PenField;
  /** The riders racing the watched one for places, and how they compare. */
  rivals?: Rival[];
}

/**
 * A rider within a few places of the watched one, and how they compare:
 * each difference is theirs minus the watched rider's, so positive means
 * the rival is stronger there.
 */
export interface Rival extends FieldRider {
  vsRider: {
    racingScore?: number;
    /** Watts per kilo over their best 15 seconds today: the sprint. */
    sprintWkg?: number;
    /** Over their best minute: the punch for short climbs and attacks. */
    punchWkg?: number;
    /** Over their best five minutes: what they can hold on a long climb or a break. */
    fiveMinWkg?: number;
  };
  /** Plain words for where they're stronger or weaker, from those numbers. */
  edge: string[];
}

/** The start pen, for pre-race talk about the field. */
export interface PenField {
  /** Everyone Sauce can see, the watched rider included. */
  riders: number;
  /** The strongest by racing score, best first. */
  topRiders: FieldRider[];
  /** Where the watched rider ranks in the pen by racing score. */
  riderRankByScore?: number;
  /** Teams with the most riders in the pen. */
  teams: { team: string; riders: number; names: string[] }[];
  /** How the pen breaks down by category. */
  categories: Record<string, number>;
}

/** One finisher, from Zwift's results via Sauce (see ./eventInfo). */
export interface RaceResult {
  athleteId: number;
  rank: number;
  name: string;
  timeMs?: number;
  avgWatts?: number;
  scoreChange?: number;
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
  | "pen"
  | "go"
  | "attack"
  | "dropped"
  | "bridged"
  | "leader"
  | "finish"
  | "result"
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
  rider?: {
    athleteId: number;
    name: string;
    firstName?: string;
    lastName?: string;
    ftp?: number;
    weight?: number;
    profile?: RiderProfile;
    team?: string;
  };
  eventSubgroupId?: number;
  event?: EventBrief;
  /** The latest view of the riders around the watched one (only the latest is kept). */
  field?: FieldSnapshot;
  remainingMetric?: "time" | "distance";
  /** The road ahead, from the route - kept up to date by a page that knows the course. */
  courseAhead?: CourseAhead;
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
/** Riders named per group in the field snapshot - enough to talk about, not a start list. */
const FIELD_PER_GROUP = 6;
/** An attack: a rider at this many watts per kilo, and this far over their group's average... */
const ATTACK_MIN_WKG = 5;
const ATTACK_RATIO = 1.4;
/** ...seen in this many group updates running (they come about a second apart). */
const ATTACK_SAMPLES = 4;
/** One attack per rider in this long, however many times they kick. */
const ATTACK_COOLDOWN_MS = 60_000;
/** Sauce's own assumption when a rider's profile has no W′. */
const DEFAULT_W_PRIME = 20_000;
/** How long each rider's recent power and W′ are kept, to read their last minute. */
const CONDITION_WINDOW_MS = 60_000;
/** Riders named at most per dropped or bridged line. */
const NAMES_PER_LINE = 3;
/** Riders and teams described in the start pen - plenty to talk through, not a start list. */
const PEN_TOP_RIDERS = 12;
/** Rivals are riders within this many places of the watched rider... */
const RIVAL_PLACES = 4;
/** ...at most this many, nearest first. */
const RIVALS = 5;
const PEN_TEAMS = 5;

/** Denser in the last kilometre, where every hundred metres changes the race. */
const DISTANCE_MARKERS_M = [100, 200, 300, 400, 500, 600, 800, 1000, 2000, 3000, 5000, 10_000, 20_000];
/** Inside this the race is in its finale, and an attack is the sprint. */
export const FINALE_M = 1000;
export const FINALE_SEC = 90;
const SPRINT_M = 500;

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
  private lastRemaining: number | undefined;
  private finished = false;
  /** Results already announced, by athlete id. */
  private resulted = new Set<number>();
  private inPen: boolean | undefined;
  /** Which group each rider was in last time, relative to the watched rider's (0 = same, -1 ahead). */
  private riderGroup = new Map<number, number>();
  private attackStreak = new Map<number, number>();
  /** Riders seen racing another category, whose chat isn't this race's. */
  private otherRaces = new Set<number>();
  /** Each rider's recent power and W′, for their condition. */
  private recent = new Map<number, { t: number; w?: number; wBal?: number }[]>();
  private attackedAt = new Map<number, number>();
  /** When each rider was last called dropped or bridged - riders at a group's edge flicker between groups. */
  private movedAt = new Map<number, number>();
  /** Each rival's power-up last time, so using one is logged once. */
  private riderPowerUp = new Map<number, string | undefined>();
  private leaderId: number | undefined;
  private lastFieldAt = -Infinity;

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
        firstName: cleanName(data.athlete?.firstName) || undefined,
        lastName: cleanName(data.athlete?.lastName) || undefined,
        ftp: data.athlete?.ftp ?? undefined,
        weight: round(data.athlete?.weight, 1),
        team: data.athlete?.team?.trim() || undefined,
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
    // Their best efforts grow as the race goes on, so this is kept current.
    if (this.log.rider) this.log.rider.profile = riderProfile(data);
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
      powerUp: powerUp(s.activePowerUp)?.name,
      // Zwift counts event distance from the start banner, so a rider signed
      // in to an event with none of it ridden and not moving is in the pen.
      pen: (!!s.eventSubgroupId && !(s.eventDistance && s.eventDistance > 0) && (s.speed ?? 0) < 2) || undefined,
    };
    this.log.samples.push(sample);
    this.detectStart(sample, now);
    this.detect(data, sample, now);
  }

  /** Into the start pen, and out of it when the race gets going. */
  private detectStart(sample: RaceSample, now: number) {
    const pen = !!sample.pen;
    if (pen && this.inPen !== true) {
      const name = this.log.event?.name;
      this.event("pen", `In the start pen${name ? ` for ${name}` : ""}`, now);
    } else if (!pen && this.inPen === true && (sample.speed ?? 0) >= 2) {
      this.event("go", "The race is under way", now);
    }
    if (pen || (sample.speed ?? 0) >= 2) this.inPen = pen;
  }

  /** Event details, once they've been looked up (see ./eventInfo). */
  setEvent(brief: EventBrief | undefined) {
    this.log.event = brief;
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

    const pu = powerUp(data.state?.activePowerUp);
    if (pu && sample.powerUp !== this.lastPowerUp) {
      this.event("powerup", `${name} uses the ${pu.name}${pu.effect ? ` (${pu.effect})` : ""}`, now);
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

    // Over the line: the remaining distance (or time) running out.
    const left = sample.remaining;
    if (!this.finished && left != null && left <= 0 && this.lastRemaining != null && this.lastRemaining > 0) {
      this.finished = true;
      const pos = sample.pos ? ` in ${ordinal(sample.pos)}${sample.of ? ` of ${sample.of}` : ""}` : "";
      // Race time from the event's start; recording may have begun in the pen.
      const startsAt = this.log.event?.startsAt;
      const time = startsAt && now > startsAt ? ` after ${formatElapsed(now - startsAt)}` : "";
      this.event("finish", `${name} crosses the line${pos}${time}`, now);
    }
    if (left != null) this.lastRemaining = left;
  }

  /** Whether the watched rider has crossed the finish line. */
  get hasFinished(): boolean {
    return this.finished;
  }

  /**
   * The event's results as Zwift publishes them, finishers in order: each
   * new finisher is logged once, the watched rider's own result with their
   * racing score change. Called again as results come in.
   */
  results(entries: RaceResult[], now = Date.now()) {
    const watchedId = this.log.rider?.athleteId;
    const fresh = entries.filter((e) => !this.resulted.has(e.athleteId));
    if (!fresh.length) return;
    for (const e of fresh) this.resulted.add(e.athleteId);
    const line = (e: RaceResult, named = true) =>
      `${ordinal(e.rank)}${named ? ` ${e.name}` : ""}${e.timeMs ? ` in ${formatElapsed(e.timeMs)}` : ""}${e.avgWatts ? `, ${e.avgWatts} W average` : ""}`;
    const mine = fresh.find((e) => e.athleteId === watchedId);
    const others = fresh.filter((e) => e !== mine);
    if (others.length) {
      const shown = others.slice(0, 5).map((e) => line(e)).join("; ");
      this.event("result", `Results: ${shown}${others.length > 5 ? ` and ${others.length - 5} more` : ""}`, now);
    }
    if (mine) {
      const change = mine.scoreChange ? `, racing score ${mine.scoreChange > 0 ? "up" : "down"} ${Math.abs(mine.scoreChange)}` : "";
      this.event("result", `Official result for ${this.log.rider?.name ?? mine.name}: ${line(mine, false)}${change}`, now);
    }
  }

  groups(all: SauceGroup[], now = Date.now()) {
    const groups = this.sameRace(all);
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

    if (watchedIdx >= 0) this.followField(groups, watchedIdx, now);

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

  /**
   * The groups as this race sees them. Zwift puts every category on the
   * same road, so a bunch can carry riders from another race - the A riders
   * coming through, the C riders being caught. In an event only the
   * rider's own category counts: the others are left out of each group (its
   * numbers worked out again from who's left) and groups of only them go.
   * Riders whose category Sauce doesn't know are kept.
   */
  private sameRace(groups: SauceGroup[]): SauceGroup[] {
    const sg = this.log.eventSubgroupId;
    if (!sg) return groups;
    for (const g of groups) {
      for (const a of g.athletes ?? []) {
        const theirs = a.state?.eventSubgroupId;
        if (theirs && theirs !== sg) this.otherRaces.add(a.athleteId);
        else if (theirs === sg) this.otherRaces.delete(a.athleteId);
      }
    }
    return sameRaceGroups(groups, sg);
  }

  /**
   * The rest of the race: who's in the rider's group and the groups either
   * side, and the moments involving other riders - an attack, riders
   * dropped from the group or bridging up to it, a new race leader.
   */
  private followField(groups: SauceGroup[], watchedIdx: number, now: number) {
    // Everyone's last minute, kept up to date before anyone is described.
    const inSight = new Set<number>();
    for (const g of groups) {
      for (const a of g.athletes ?? []) {
        inSight.add(a.athleteId);
        const list = (this.recent.get(a.athleteId) ?? []).filter((x) => now - x.t <= CONDITION_WINDOW_MS);
        if (list.at(-1)?.t !== now) list.push({ t: now, w: a.state?.power, wBal: a.wBal });
        this.recent.set(a.athleteId, list);
      }
    }
    for (const id of this.recent.keys()) if (!inSight.has(id)) this.recent.delete(id);

    const condition = (a: SauceGroup["athletes"][number]): RiderCondition | undefined => {
      const ftp = a.athlete?.ftp;
      const list = this.recent.get(a.athleteId) ?? [];
      const watts = list.map((x) => x.w).filter((w): w is number => w != null);
      const avgW = watts.length ? watts.reduce((x, y) => x + y, 0) / watts.length : undefined;
      const capacity = a.athlete?.wPrime || DEFAULT_W_PRIME;
      const wBalPct = a.wBal != null ? Math.max(0, Math.min(100, Math.round((a.wBal / capacity) * 100))) : undefined;
      const oldest = list.find((x) => x.wBal != null);
      const change = a.wBal != null && oldest?.wBal != null && now - oldest.t >= 15_000 ? round((a.wBal - oldest.wBal) / 1000, 1) : undefined;
      const pctNow = ftp && a.state?.power != null ? Math.round((a.state.power / ftp) * 100) : undefined;
      const pctMin = ftp && avgW != null ? Math.round((avgW / ftp) * 100) : undefined;
      if (wBalPct == null && pctNow == null) return undefined;
      const state =
        wBalPct != null && wBalPct < 10
          ? "empty"
          : wBalPct != null && wBalPct < 30
            ? change != null && change > 0.5 ? "recovering" : "on the limit"
            : change != null && change < -2
              ? "digging deep"
              : pctMin != null && pctMin >= 100
                ? "working"
                : wBalPct != null && wBalPct >= 90 && (pctMin == null || pctMin < 85)
                  ? "fresh"
                  : "comfortable";
      return { wBalPct, wBalKj: a.wBal != null ? round(a.wBal / 1000, 1) : undefined, wBalChange1MinKj: change, pctFtpNow: pctNow, pctFtpLastMinute: pctMin, state };
    };

    const named = (a: SauceGroup["athletes"][number]): FieldRider => {
      const first = cleanName(a.athlete?.firstName);
      const last = cleanName(a.athlete?.lastName);
      const power = a.state?.power;
      const weight = a.athlete?.weight;
      return {
        name: [first, last].filter(Boolean).join(" ") || `Rider ${a.athleteId}`,
        team: a.athlete?.team?.trim() || undefined,
        pos: a.eventPosition || undefined,
        wkg: power != null && weight ? round(power / weight, 1) : undefined,
        power: round(power),
        gap: round(a.gap, 1),
        profile: riderProfile(a),
        condition: condition(a),
      };
    };
    const own = groups[watchedIdx];
    const watchedId = this.log.rider?.athleteId;

    // Attacks from the rider's own group or the one ahead of it.
    for (const g of [own, groups[watchedIdx - 1]]) {
      if (!g?.athletes?.length) continue;
      const avgWkg = g.weight && g.power ? g.power / g.weight : undefined;
      for (const a of g.athletes) {
        const r = named(a);
        const attacking = r.wkg != null && r.wkg >= ATTACK_MIN_WKG && (!avgWkg || r.wkg >= avgWkg * ATTACK_RATIO);
        const streak = attacking ? (this.attackStreak.get(a.athleteId) ?? 0) + 1 : 0;
        this.attackStreak.set(a.athleteId, streak);
        if (streak === ATTACK_SAMPLES && a.athleteId !== watchedId &&
            now - (this.attackedAt.get(a.athleteId) ?? -Infinity) >= ATTACK_COOLDOWN_MS) {
          this.attackedAt.set(a.athleteId, now);
          const where = g === own ? "from the group" : "in the group ahead";
          const left = this.log.remainingMetric === "distance" ? this.log.samples.at(-1)?.remaining : undefined;
          this.event(
            "attack",
            left != null && left > 0 && left <= SPRINT_M
              ? `${r.name} launches the sprint ${where} at ${r.wkg} W/kg (${r.power} W), ${Math.round(left)} m out`
              : `${r.name} attacks ${where} at ${r.wkg} W/kg (${r.power} W)`,
            now,
          );
        }
      }
    }

    // Power-ups used by the riders around - a rival on the Feather is a story.
    for (const g of [own, groups[watchedIdx - 1], groups[watchedIdx + 1]]) {
      for (const a of g?.athletes ?? []) {
        if (a.athleteId === watchedId) continue;
        const pu = powerUp(a.state?.activePowerUp);
        const before = this.riderPowerUp.get(a.athleteId);
        if (pu && pu.name !== before && this.riderPowerUp.has(a.athleteId)) {
          const where = g === own ? "" : g === groups[watchedIdx - 1] ? " in the group ahead" : " in the group behind";
          this.event("powerup", `${named(a).name}${where} uses the ${pu.name}${pu.effect ? ` (${pu.effect})` : ""}`, now);
        }
        this.riderPowerUp.set(a.athleteId, pu?.name);
      }
    }

    // Riders changing group relative to the rider's: dropped, or bridging up.
    const dropped: string[] = [];
    const bridged: string[] = [];
    const seen = new Map<number, number>();
    groups.forEach((g, i) => {
      for (const a of g.athletes ?? []) {
        if (a.athleteId === watchedId) continue;
        const rel = Math.sign(i - watchedIdx);
        seen.set(a.athleteId, rel);
        const before = this.riderGroup.get(a.athleteId);
        const settled = now - (this.movedAt.get(a.athleteId) ?? -Infinity) >= ATTACK_COOLDOWN_MS;
        if (before === 0 && rel > 0 && settled) {
          dropped.push(named(a).name);
          this.movedAt.set(a.athleteId, now);
        }
        if (before != null && before > 0 && rel === 0 && settled) {
          bridged.push(named(a).name);
          this.movedAt.set(a.athleteId, now);
        }
      }
    });
    // A whole-group split or merge is already its own event; this is for
    // riders coming and going one or two at a time.
    const lines = (names: string[]) => names.slice(0, NAMES_PER_LINE).join(", ") + (names.length > NAMES_PER_LINE ? ` and ${names.length - NAMES_PER_LINE} more` : "");
    if (dropped.length && dropped.length <= 4) this.event("dropped", `${lines(dropped)} ${dropped.length === 1 ? "has" : "have"} been dropped from the group`, now);
    if (bridged.length && bridged.length <= 4) this.event("bridged", `${lines(bridged)} ${bridged.length === 1 ? "has" : "have"} bridged up to the group`, now);
    this.riderGroup = seen;

    // The race leader, when they're in sight.
    const leader = groups.flatMap((g) => g.athletes ?? []).find((a) => a.eventPosition === 1);
    if (leader && leader.athleteId !== this.leaderId) {
      if (this.leaderId != null) this.event("leader", `${named(leader).name} takes the lead of the race`, now);
      this.leaderId = leader.athleteId;
    }

    if (now - this.lastFieldAt < GROUPS_EVERY_MS) return;
    this.lastFieldAt = now;
    const top = (g: SauceGroup | undefined) =>
      g?.athletes?.length
        ? g.athletes
            .filter((a) => a.athleteId !== watchedId)
            .map(named)
            .sort((x, y) => (y.wkg ?? 0) - (x.wkg ?? 0))
            .slice(0, FIELD_PER_GROUP)
        : undefined;
    this.log.field = {
      t: this.at(now),
      ridersGroup: top(own) ?? [],
      groupAhead: top(groups[watchedIdx - 1]),
      groupBehind: top(groups[watchedIdx + 1]),
      leader: leader && leader.athleteId !== watchedId ? named(leader) : undefined,
      toWatch: [own, groups[watchedIdx - 1]]
        .flatMap((g) => g?.athletes ?? [])
        .filter((a) => a.athleteId !== watchedId && a.athlete?.racingScore)
        .sort((x, y) => (y.athlete?.racingScore ?? 0) - (x.athlete?.racingScore ?? 0))
        .slice(0, 3)
        .map(named),
      pen: this.log.samples.at(-1)?.pen ? this.penField(groups, named) : undefined,
      rivals: this.rivals(groups, named),
    };
  }

  /** The riders closest in the race, and where each is stronger or weaker. */
  private rivals(groups: SauceGroup[], named: (a: SauceGroup["athletes"][number]) => FieldRider): Rival[] | undefined {
    const watchedId = this.log.rider?.athleteId;
    const everyone = groups.flatMap((g) => g.athletes ?? []);
    const me = everyone.find((a) => a.athleteId === watchedId);
    const myPos = me?.eventPosition;
    const mine = this.log.rider?.profile;
    if (!myPos) return undefined;
    const diff = (theirs: number | undefined, ours: number | undefined, dp = 1) =>
      theirs != null && ours != null ? round(theirs - ours, dp) : undefined;
    return everyone
      .filter((a) => a.athleteId !== watchedId && a.eventPosition && Math.abs(a.eventPosition - myPos) <= RIVAL_PLACES)
      .sort((x, y) => Math.abs((x.eventPosition ?? 0) - myPos) - Math.abs((y.eventPosition ?? 0) - myPos))
      .slice(0, RIVALS)
      .map((a) => {
        const r = named(a);
        const p = r.profile;
        const vsRider = {
          racingScore: diff(p?.racingScore, mine?.racingScore, 0),
          sprintWkg: diff(p?.best15sWkg, mine?.best15sWkg),
          punchWkg: diff(p?.best1minWkg, mine?.best1minWkg),
          fiveMinWkg: diff(p?.best5minWkg, mine?.best5minWkg),
        };
        const edge: string[] = [];
        const say = (v: number | undefined, margin: number, better: string, worse: string) => {
          if (v == null) return;
          if (v >= margin) edge.push(better);
          else if (v <= -margin) edge.push(worse);
        };
        say(vsRider.racingScore, 40, "higher racing score", "lower racing score");
        say(vsRider.sprintWkg, 0.8, "stronger sprint", "weaker sprint");
        say(vsRider.punchWkg, 0.5, "more punch", "less punch");
        say(vsRider.fiveMinWkg, 0.3, "stronger over five minutes", "weaker over five minutes");
        return { ...r, vsRider, edge };
      });
  }

  /** Who's lined up in the pen: the favourites, the big teams, the categories. */
  private penField(groups: SauceGroup[], named: (a: SauceGroup["athletes"][number]) => FieldRider): PenField {
    const everyone = groups.flatMap((g) => g.athletes ?? []);
    const watchedId = this.log.rider?.athleteId;
    const byScore = everyone
      .filter((a) => a.athlete?.racingScore)
      .sort((x, y) => (y.athlete?.racingScore ?? 0) - (x.athlete?.racingScore ?? 0));
    const rank = byScore.findIndex((a) => a.athleteId === watchedId);
    const teams = new Map<string, string[]>();
    const categories: Record<string, number> = {};
    for (const a of everyone) {
      const team = a.athlete?.team?.trim();
      const r = named(a);
      if (team) teams.set(team, [...(teams.get(team) ?? []), r.name]);
      const cat = a.athlete?.racingCategory;
      if (cat) categories[cat] = (categories[cat] ?? 0) + 1;
    }
    return {
      riders: everyone.length,
      topRiders: byScore.filter((a) => a.athleteId !== watchedId).slice(0, PEN_TOP_RIDERS).map(named),
      riderRankByScore: rank >= 0 ? rank + 1 : undefined,
      teams: Array.from(teams, ([team, names]) => ({ team, riders: names.length, names: names.slice(0, 4) }))
        .filter((t) => t.riders > 1)
        .sort((x, y) => y.riders - x.riders)
        .slice(0, PEN_TEAMS),
      categories,
    };
  }

  /** A line of commentary or a tactical call, kept so the review can see what was said. */
  radio(kind: "commentary" | "tactic", text: string, now = Date.now()) {
    this.event(kind, text, now);
  }

  chat(chat: SauceChat, now = Date.now()) {
    const message = chat.message?.trim();
    if (!message) return;
    // Chat from a rider in another category's race isn't part of this one.
    if (chat.from != null && this.otherRaces.has(chat.from)) return;
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
