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
  /** World position, in centimetres - the same space as Sauce's road paths. */
  x?: number;
  y?: number;
}

export interface SauceAthlete {
  firstName?: string;
  lastName?: string;
  ftp?: number | null;
  weight?: number;
  /** ISO 3166 numeric; Sauce maps it to a flag via its countries.json. */
  countryCode?: number;
  racingCategory?: string;
  /** Zwift Racing Score, from the rider's recent race results. */
  racingScore?: number;
  level?: number;
  /** Riding with a real power meter or smart trainer, not estimated power. */
  powerMeter?: boolean;
  /** W′ capacity in joules; Sauce assumes 20 kJ when the profile has none. */
  wPrime?: number;
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
    power?: {
      avg?: number;
      max?: number;
      np?: number;
      /** Best average power over 5, 15, 60, 300, 1200 and 3600 seconds, since Sauce first saw the rider. */
      peaks?: Record<string, { avg?: number | null }>;
    };
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

/** Only the events a page has a handler for are subscribed to. */
export interface FeedHandlers {
  onStatus: (status: FeedStatus) => void;
  onWatching?: (data: SauceAthleteData) => void;
  onGroups?: (groups: SauceGroup[]) => void;
  onChat?: (chat: SauceChat) => void;
  /** Every rider Sauce can see, nearest first. */
  onNearby?: (riders: SauceAthleteData[]) => void;
}

export const DEFAULT_SAUCE_ADDRESS = "localhost:1080";

/**
 * Where Sauce is, for a page Sauce itself serves. In a browser that's the
 * address the page came from. Sauce's own windows (Electron) load mod pages
 * from file:///mods/..., which has no host, so they fall back to the
 * address saved in the console, or Sauce's default port.
 */
export function sauceAddressForModPage(): string {
  if (/^https?:$/.test(window.location.protocol) && window.location.host) return window.location.host;
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem("race:sauce-address") ?? "null");
    if (typeof saved === "string" && saved.trim()) return saved;
  } catch {
    // Nothing saved, or no storage - the default it is.
  }
  return DEFAULT_SAUCE_ADDRESS;
}

/** Starts at 1s and stretches to 15s while Sauce stays down. */
const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 15_000;
/**
 * Chrome holds a connection to localhost open, neither failing nor
 * connecting, while it waits on its local network access permission. Give
 * up after this long so the page can say so instead of spinning forever.
 */
const CONNECT_TIMEOUT_MS = 8000;

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
      // Thrown, not closed, when the page's Content-Security-Policy or the
      // browser refuses the address outright.
      handlers.onStatus("disconnected");
      scheduleRetry();
      return;
    }
    ws = socket;
    const timeout = setTimeout(() => {
      if (socket.readyState === WebSocket.CONNECTING) socket.close();
    }, CONNECT_TIMEOUT_MS);

    // uid -> event name, for the events subscribed on this socket.
    const subs = new Map<number, string>();
    let uid = 1;
    const subscribe = (event: string) => {
      const subId = uid++;
      subs.set(subId, event);
      socket.send(JSON.stringify({ type: "request", uid: uid++, data: { method: "subscribe", arg: { event, subId } } }));
    };

    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      backoff = MIN_BACKOFF_MS;
      handlers.onStatus("connected");
      if (handlers.onWatching) subscribe("athlete/watching");
      if (handlers.onGroups) subscribe("groups");
      if (handlers.onChat) subscribe("chat");
      if (handlers.onNearby) subscribe("nearby");
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
          handlers.onWatching?.(msg.data as SauceAthleteData);
          break;
        case "groups":
          if (Array.isArray(msg.data)) handlers.onGroups?.(msg.data as SauceGroup[]);
          break;
        case "chat":
          handlers.onChat?.(msg.data as SauceChat);
          break;
        case "nearby":
          if (Array.isArray(msg.data)) handlers.onNearby?.(msg.data as SauceAthleteData[]);
          break;
      }
    });

    socket.addEventListener("close", () => {
      clearTimeout(timeout);
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

/**
 * Chrome's answer on letting this site reach localhost, where it can say.
 * The permission has been renamed as it rolled out, so each name is tried;
 * a browser that knows none of them returns null and doesn't gate it.
 */
export async function localNetworkPermission(): Promise<PermissionState | null> {
  for (const name of ["loopback-network", "local-network-access", "local-network"]) {
    try {
      const result = await navigator.permissions.query({ name: name as PermissionName });
      return result.state;
    } catch {
      // Not a permission this browser knows.
    }
  }
  return null;
}

/**
 * A Zwift name without what riders tack on to it: team tags in brackets
 * ("Lambert (GTR Skeleton Wheelers)", "[WKG] Ules"), and anything after a
 * bar or a hyphen surrounded by spaces ("Barske | TUC").
 */
export function cleanName(name: string | undefined): string {
  return (name ?? "")
    .replace(/[([{][^)\]}]*[)\]}]/g, " ")
    .split(/\s[|/]\s|\s-\s/)[0]
    .replace(/\s+/g, " ")
    .trim();
}

export function athleteName(a: SauceAthleteData | undefined): string {
  const first = a?.athlete?.firstName?.trim() ?? "";
  const last = a?.athlete?.lastName?.trim() ?? "";
  const name = `${first} ${last}`.trim();
  return name || (a ? `Rider ${a.athleteId}` : "—");
}

/**
 * Calls one of Sauce's RPC functions over its REST API
 * (GET /api/rpc/v2/<name>/<base64url JSON arg>...), which answers
 * {success, value}. Sauce serves the API with open CORS, so mod pages can
 * use it from file:// as well as from Sauce's own address.
 */
export async function sauceRpc<T>(address: string, name: string, ...args: unknown[]): Promise<T> {
  const encoded = args.map((a) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(a))))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, ""),
  );
  const res = await fetch(`http://${address}/api/rpc/v2/${[name, ...encoded].join("/")}`);
  const body = (await res.json()) as { success?: boolean; value?: T; error?: { message?: string } };
  if (!res.ok || !body.success) throw new Error(body.error?.message ?? `Sauce ${name} failed (${res.status})`);
  return body.value as T;
}
