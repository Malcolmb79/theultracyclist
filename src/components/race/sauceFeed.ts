// Live race data from Sauce for Zwift's local web server.
//
// Sauce runs on the Zwift PC as a second Zwift client and republishes what
// it sees over a WebSocket at /api/ws/events. Requests go out as
// {type: "request", uid, data: {method, arg}}, each one is answered by a
// {type: "response", uid, success} and, once subscribed, every event
// arrives as {type: "event", uid: subId, data}. The field names below are
// the ones Sauce's own pages read (src/stats.mjs, _formatAthleteData and
// _computeGroups in SauceLLC/sauce4zwift); everything is optional because
// what Sauce sends depends on what Zwift has told it so far, and on the
// event's privacy settings.
//
// The page connects straight from the browser: Sauce sends no Origin check
// on the socket, and Chrome treats ws://localhost as a secure context, so
// the deployed https site can reach it as long as the page is opened on the
// Zwift PC itself.

export interface SauceState {
  athleteId?: number;
  worldTime?: number;
  power?: number;
  heartrate?: number;
  cadence?: number;
  /** km/h */
  speed?: number;
  /** Metres ridden this session. */
  distance?: number;
  /** Metres into the event (only set while in one). */
  eventDistance?: number;
  altitude?: number;
  /** Fraction, e.g. 0.05 for 5%. */
  grade?: number;
  draft?: number;
  activePowerUp?: string;
  eventSubgroupId?: number;
  routeId?: number;
  courseId?: number;
}

export interface SauceAthlete {
  firstName?: string;
  lastName?: string;
  ftp?: number | null;
  weight?: number;
  countryCode?: number;
  racingCategory?: string;
  team?: string;
}

export interface SauceAthleteData {
  athleteId: number;
  self?: boolean;
  watching?: boolean;
  athlete?: SauceAthlete;
  state?: SauceState | null;
  eventPosition?: number;
  eventParticipants?: number;
  /** Seconds to the watched rider; negative is ahead. */
  gap?: number;
  gapDistance?: number;
  /** Joules left in the anaerobic tank, when the event allows it. */
  wBal?: number;
  remaining?: number;
  remainingMetric?: "time" | "distance";
  remainingType?: "event" | "route";
  remainingEnd?: number;
  stats?: {
    power?: { avg?: number; max?: number; np?: number };
    heartrate?: { avg?: number; max?: number };
  };
}

export interface SauceGroup {
  id?: number;
  athletes: SauceAthleteData[];
  watching?: boolean;
  /** Seconds to the watched rider's group; negative is ahead. */
  gap?: number;
  innerGap?: number;
  lengthTime?: number;
  lengthDistance?: number;
  power?: number;
  speed?: number;
  heartrate?: number | null;
  weight?: number;
}

export interface SauceChat {
  from?: number;
  firstName?: string;
  lastName?: string;
  message?: string;
  eventLeader?: boolean;
  eventSweeper?: boolean;
}

export type FeedStatus = "connecting" | "connected" | "disconnected";

export interface FeedHandlers {
  onStatus: (status: FeedStatus) => void;
  onWatching: (data: SauceAthleteData) => void;
  onGroups: (groups: SauceGroup[]) => void;
  onChat: (chat: SauceChat) => void;
}

export const DEFAULT_SAUCE_ADDRESS = "localhost:1080";

/** Starts at 1s and stretches to 15s while Sauce stays down. */
const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 15_000;

/**
 * Connects to Sauce and keeps reconnecting until the returned function is
 * called. Each reconnect re-subscribes from scratch, since Sauce forgets a
 * socket's subscriptions when it closes.
 */
export function connectSauce(address: string, handlers: FeedHandlers): () => void {
  let ws: WebSocket | null = null;
  let stopped = false;
  let backoff = MIN_BACKOFF_MS;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const open = () => {
    if (stopped) return;
    handlers.onStatus("connecting");
    // Plain ws:// for localhost; Sauce's optional HTTPS server (1081) uses a
    // self-signed certificate the browser would have to be told to trust.
    const scheme = address.endsWith(":1081") ? "wss" : "ws";
    let socket: WebSocket;
    try {
      socket = new WebSocket(`${scheme}://${address}/api/ws/events`);
    } catch {
      scheduleRetry();
      return;
    }
    ws = socket;

    // uid -> event name, for the events subscribed on this socket.
    const subs = new Map<number, string>();
    let uid = 1;
    const subscribe = (event: string) => {
      const subId = uid++;
      subs.set(subId, event);
      socket.send(JSON.stringify({ type: "request", uid: uid++, data: { method: "subscribe", arg: { event, subId } } }));
    };

    socket.addEventListener("open", () => {
      backoff = MIN_BACKOFF_MS;
      handlers.onStatus("connected");
      subscribe("athlete/watching");
      subscribe("groups");
      subscribe("chat");
    });

    socket.addEventListener("message", (ev) => {
      let msg: { type?: string; uid?: number; success?: boolean; data?: unknown; error?: string };
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
      } catch {
        return;
      }
      if (msg.type !== "event" || msg.uid == null || msg.data == null) return;
      switch (subs.get(msg.uid)) {
        case "athlete/watching":
          handlers.onWatching(msg.data as SauceAthleteData);
          break;
        case "groups":
          if (Array.isArray(msg.data)) handlers.onGroups(msg.data as SauceGroup[]);
          break;
        case "chat":
          handlers.onChat(msg.data as SauceChat);
          break;
      }
    });

    socket.addEventListener("close", () => {
      if (ws === socket) ws = null;
      if (stopped) return;
      handlers.onStatus("disconnected");
      scheduleRetry();
    });
  };

  const scheduleRetry = () => {
    if (stopped) return;
    retry = setTimeout(open, backoff);
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  };

  open();

  return () => {
    stopped = true;
    clearTimeout(retry);
    ws?.close();
    ws = null;
  };
}

export function athleteName(a: SauceAthleteData | undefined): string {
  const first = a?.athlete?.firstName?.trim() ?? "";
  const last = a?.athlete?.lastName?.trim() ?? "";
  const name = `${first} ${last}`.trim();
  return name || (a ? `Rider ${a.athleteId}` : "—");
}
