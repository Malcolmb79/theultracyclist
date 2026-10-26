import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { OverlayShell, useSettings, type SettingDef } from "./overlay";
import { useSauce } from "./useSauce";
import shell from "./Overlay.module.css";
import tool from "./Tool.module.css";

// Race your own ghost: every ride of a route is recorded - the time at
// each point along it - and the next ride is compared with the best (or
// the last) at the same distance, the way a bike computer races a saved
// activity. Kept on this computer, a few rides per route.
//
// Distance is measured from the start of the event (or, riding freely,
// from where the route was picked up), so only rides started from the
// beginning are recorded.

const DEFAULTS = { opacity: 80, against: "best" };
const DEFS: SettingDef[] = [
  {
    key: "against",
    label: "Race against",
    type: "select",
    options: [
      { value: "best", label: "My best ride of the route" },
      { value: "last", label: "My last ride of the route" },
    ],
  },
];

/** A point every this many metres. */
const STEP_M = 25;
/** Rides kept per route: the best few and the latest. */
const KEEP = 5;
/** Only a ride picked up this close to its start is recorded. */
const START_M = 300;

interface Ride {
  /** When it was ridden. */
  at: number;
  /** Seconds since the start at each STEP_M metres. */
  times: number[];
}

const key = (routeId: number, event: boolean) => `ghost:${routeId}:${event ? "event" : "free"}`;

function loadRides(k: string): Ride[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(k) ?? "[]") as Ride[];
    return Array.isArray(v) ? v.filter((r) => Array.isArray(r.times)) : [];
  } catch {
    return [];
  }
}

function saveRide(k: string, ride: Ride) {
  if (ride.times.length < 40) return; // Under a kilometre: not worth a ghost.
  const rides = loadRides(k).filter((r) => r.at !== ride.at);
  rides.push(ride);
  // The latest, then the furthest-and-fastest.
  const latest = rides.reduce((a, r) => (r.at > a.at ? r : a));
  const rest = rides
    .filter((r) => r !== latest)
    .sort((a, b) => b.times.length - a.times.length || (a.times.at(-1) ?? 0) - (b.times.at(-1) ?? 0))
    .slice(0, KEEP - 1);
  try {
    window.localStorage.setItem(k, JSON.stringify([latest, ...rest]));
  } catch {
    // Full - the ghost just won't be saved.
  }
}

/** A ride's time at a distance, between its points. */
function timeAt(ride: Ride, d: number): number | undefined {
  const i = d / STEP_M;
  const a = Math.floor(i);
  if (a + 1 >= ride.times.length) return undefined;
  return ride.times[a] + (ride.times[a + 1] - ride.times[a]) * (i - a);
}

function GhostOverlay() {
  const [settings, set] = useSettings("ghost", DEFAULTS);
  const { watching, status } = useSauce({});
  const s = watching?.state;
  const routeId = s?.routeId;
  const event = !!s?.eventSubgroupId;

  // The ride being recorded: where it started (in Sauce's distance) and its times so far.
  const current = useRef<{ k: string; startDist: number; startAt: number; ride: Ride } | null>(null);
  const [rides, setRides] = useState<Ride[]>([]);

  const dist = event ? s?.eventDistance : s?.distance;
  useEffect(() => {
    if (routeId == null || dist == null || watching?.self === false) return;
    const k = key(routeId, event);
    const now = Date.now();
    let c = current.current;
    // A new route, or the distance went backwards (a new event): the last ride is done.
    if (c && (c.k !== k || dist < c.startDist + (c.ride.times.length - 1) * STEP_M - 200)) {
      saveRide(c.k, c.ride);
      c = null;
    }
    if (!c) {
      // Free riding starts the count where the route was picked up; an event, at its start.
      const start = event ? 0 : dist;
      if (dist - start > START_M) return;
      c = { k, startDist: start, startAt: now - ((dist - start) / Math.max(1, (s?.speed ?? 30) / 3.6)) * 1000, ride: { at: now, times: [] } };
      current.current = c;
      setRides(loadRides(k));
    }
    const along = dist - c.startDist;
    while (c.ride.times.length * STEP_M <= along) c.ride.times.push((now - c.startAt) / 1000);
    // Saved as it goes, so a closed window or a crash keeps the ride.
    if (c.ride.times.length % 40 === 0) saveRide(c.k, c.ride);
  }, [routeId, dist, event]); // eslint-disable-line react-hooks/exhaustive-deps

  // Saved when the window closes, too.
  useEffect(() => {
    const save = () => current.current && saveRide(current.current.k, current.current.ride);
    window.addEventListener("beforeunload", save);
    return () => window.removeEventListener("beforeunload", save);
  }, []);

  const c = current.current;
  const along = c && dist != null ? dist - c.startDist : undefined;
  const mine = c && along != null ? (Date.now() - c.startAt) / 1000 : undefined;
  const others = rides.filter((r) => r.at !== c?.ride.at && along != null && timeAt(r, along) != null);
  const ghost =
    settings.against === "last"
      ? others.reduce<Ride | undefined>((a, r) => (!a || r.at > a.at ? r : a), undefined)
      : others.reduce<Ride | undefined>((a, r) => (!a || timeAt(r, along!)! < timeAt(a, along!)! ? r : a), undefined);
  const delta = ghost && mine != null ? mine - timeAt(ghost, along!)! : undefined;
  const metres = delta != null && s?.speed ? Math.round(Math.abs(delta) * (s.speed / 3.6)) : undefined;

  return (
    <OverlayShell title="Ghost" settings={settings} setSetting={set} defs={DEFS}>
      <div className={`${shell.panel} ${tool.panel}`}>
        {status !== "connected" ? (
          <p className={tool.waiting}>Connecting to Sauce…</p>
        ) : !c ? (
          <p className={tool.waiting}>Records your ride from the start of a route, to race next time.</p>
        ) : delta == null ? (
          <>
            <div className={tool.top}>
              <span className={tool.label}>Ghost</span>
              <span className={tool.tag}>Recording</span>
            </div>
            <p className={tool.line}>First time on this route - your ghost will be waiting next time.</p>
          </>
        ) : (
          <>
            <div className={tool.top}>
              <span className={tool.label}>Ghost</span>
              <span className={tool.tag}>{settings.against === "last" ? "vs last ride" : "vs best ride"}</span>
            </div>
            <div className={`${tool.big} ${delta <= 0 ? tool.good : tool.bad}`}>
              {delta <= 0 ? "−" : "+"}
              {Math.abs(delta).toFixed(1)}
              <small>s</small>
            </div>
            <p className={tool.line}>
              {delta <= 0 ? "Ahead of" : "Behind"} your ghost{metres != null ? ` by ${metres} m` : ""}
            </p>
            <p className={`${tool.line} ${tool.muted}`}>
              {others.length} earlier {others.length === 1 ? "ride" : "rides"} of this route
            </p>
          </>
        )}
      </div>
    </OverlayShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <GhostOverlay />
  </StrictMode>,
);
