import { useEffect, type RefObject } from "react";
import type { EventBrief, RaceRecorder } from "./raceLog";
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
