import { useEffect, useRef, type RefObject } from "react";
import type { EventBrief, RaceRecorder, RaceResult } from "./raceLog";
import { sauceRpc } from "./sauceFeed";

// The event behind a race, looked up from Sauce as soon as the rider is
// signed in to one - so the coach knows, while still in the start pen, how
// long the race is, how much climbing, whether there are power-ups, and
// exactly when it starts.

interface SauceEventSubgroup {
  name?: string;
  subgroupLabel?: string;
  /** Start time, epoch milliseconds. */
  ts?: number;
  laps?: number;
  distanceInMeters?: number;
  routeDistance?: number;
  routeClimbing?: number;
  durationInSeconds?: number;
  powerUps?: unknown;
}

const briefs = new Map<string, Promise<EventBrief | undefined>>();

export function loadEventBrief(address: string, subgroupId: number): Promise<EventBrief | undefined> {
  const key = `${address}|${subgroupId}`;
  let p = briefs.get(key);
  if (!p) {
    p = sauceRpc<SauceEventSubgroup | null>(address, "getEventSubgroup", subgroupId).then((sg) => {
      if (!sg) throw new Error("Event not known yet");
      const metres = sg.distanceInMeters || sg.routeDistance;
      return {
        name: sg.name,
        label: sg.subgroupLabel,
        startsAt: sg.ts,
        distanceKm: metres ? Math.round(metres / 100) / 10 : undefined,
        climbM: sg.routeClimbing != null ? Math.round(sg.routeClimbing) : undefined,
        laps: sg.laps || undefined,
        durationMin: sg.durationInSeconds ? Math.round(sg.durationInSeconds / 60) : undefined,
        // Sauce lists the power-up odds when the event has any; none means none.
        powerUps: sg.powerUps == null ? undefined : Object.keys(sg.powerUps as object).length > 0,
      };
    });
    // Sauce may not have fetched the event from Zwift yet; ask again later.
    p.catch(() => setTimeout(() => briefs.delete(key), 15_000));
    briefs.set(key, p);
  }
  return p;
}

/**
 * Keeps the recorder's event details in step with the event being ridden.
 * `recorderKey` changes whenever a new recorder is started, so it gets them too.
 */
export function useEventBrief(
  address: string,
  subgroupId: number | undefined,
  recorder: RefObject<RaceRecorder | null>,
  recorderKey?: unknown,
) {
  useEffect(() => {
    if (!subgroupId) {
      recorder.current?.setEvent(undefined);
      return;
    }
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const attempt = () =>
      loadEventBrief(address, subgroupId)
        .then((brief) => {
          if (!cancelled) recorder.current?.setEvent(brief);
        })
        .catch(() => {
          if (!cancelled) retry = setTimeout(attempt, 20_000);
        });
    void attempt();
    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
  }, [address, subgroupId, recorder, recorderKey]);
}

interface SauceResultEntry {
  profileId: number;
  dnf?: boolean;
  dns?: boolean;
  pending?: boolean;
  activityData?: { durationInMilliseconds?: number };
  profileData?: { firstName?: string; lastName?: string };
  sensorData?: { avgWatts?: number | null };
  scoreHistory?: { previousScore?: number; newScore?: number };
}

/** How often to ask for results once the rider has finished, and for how long. */
const RESULTS_EVERY_MS = 20_000;
const RESULTS_FOR_MS = 15 * 60_000;

/**
 * Zwift's results for the event, from Sauce, finishers only and in order.
 * Sauce lists riders still out on the road (and non-starters) after the
 * finishers; those are left for a later call.
 */
export async function loadResults(address: string, subgroupId: number): Promise<RaceResult[]> {
  const entries = await sauceRpc<SauceResultEntry[] | null>(address, "getEventSubgroupResults", subgroupId);
  return (entries ?? [])
    .filter((e) => !e.dnf && !e.dns && !e.pending)
    .map((e, i) => {
      const before = e.scoreHistory?.previousScore;
      const after = e.scoreHistory?.newScore;
      const name = [e.profileData?.firstName, e.profileData?.lastName].filter(Boolean).join(" ").trim();
      return {
        athleteId: e.profileId,
        rank: i + 1,
        name: name || `Rider ${e.profileId}`,
        timeMs: e.activityData?.durationInMilliseconds || undefined,
        avgWatts: e.sensorData?.avgWatts ? Math.round(e.sensorData.avgWatts) : undefined,
        scoreChange: before != null && after != null && after !== before ? Math.round(after - before) : undefined,
      };
    });
}

/**
 * Once the watched rider has crossed the line, asks Sauce for the event's
 * results every 20 seconds for a quarter of an hour, so finishers come in
 * as Zwift publishes them - for the commentator to call the results.
 */
export function useEventResults(
  address: string,
  subgroupId: number | undefined,
  recorder: RefObject<RaceRecorder | null>,
  finished: boolean,
  onUpdate?: () => void,
) {
  const notify = useRef(onUpdate);
  notify.current = onUpdate;
  useEffect(() => {
    if (!finished || !subgroupId) return;
    const started = Date.now();
    let cancelled = false;
    const poll = () => {
      if (Date.now() - started > RESULTS_FOR_MS) return clearInterval(timer);
      loadResults(address, subgroupId)
        .then((list) => {
          if (cancelled || !recorder.current) return;
          recorder.current.results(list);
          notify.current?.();
        })
        .catch(() => {
          // Not published yet, or Zwift is slow - the next poll tries again.
        });
    };
    const timer = setInterval(poll, RESULTS_EVERY_MS);
    poll();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [address, subgroupId, recorder, finished]);
}
