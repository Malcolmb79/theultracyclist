import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { loadEventBrief } from "../components/race/eventInfo";
import type { EventBrief } from "../components/race/raceLog";
import { OverlayShell, useSettings, type SettingDef, Recover } from "./overlay";
import { useSauce } from "./useSauce";
import { routePosition, useCourse } from "./useCourse";
import { gradeBetween } from "./physics";
import shell from "./Overlay.module.css";
import styles from "./RouteInfo.module.css";

// The route at a glance: its name and world, how far it is and how far is
// left, the climbing done and still to come, the lap, the lead-in, the time
// and a finish estimate, and what's coming up - each a setting. Distances
// and climbing come from the route's own profile, laps and all, and the
// event's details when racing.

const DEFAULTS = {
  opacity: 80,
  world: true,
  event: true,
  distance: true,
  remaining: true,
  bar: true,
  climbing: true,
  climbLeft: true,
  laps: true,
  leadin: false,
  time: true,
  eta: true,
  next: true,
  steepest: false,
  gradeLeft: false,
};
const DEFS: SettingDef[] = [
  { key: "world", label: "World", type: "toggle" },
  { key: "event", label: "Event and category", type: "toggle" },
  { key: "distance", label: "Distance (total and ridden)", type: "toggle" },
  { key: "remaining", label: "Distance remaining", type: "toggle" },
  { key: "bar", label: "Progress bar", type: "toggle" },
  { key: "climbing", label: "Climbing (total and done)", type: "toggle" },
  { key: "climbLeft", label: "Climbing remaining", type: "toggle" },
  { key: "gradeLeft", label: "Average gradient remaining", type: "toggle" },
  { key: "laps", label: "Laps", type: "toggle" },
  { key: "leadin", label: "Lead-in", type: "toggle" },
  { key: "time", label: "Time ridden", type: "toggle" },
  { key: "eta", label: "Finish estimate", type: "toggle" },
  { key: "next", label: "Next sprint or KOM", type: "toggle" },
  { key: "steepest", label: "Steepest km still to come", type: "toggle" },
];

const km = (m: number) => (m >= 10_000 ? (m / 1000).toFixed(1) : (m / 1000).toFixed(2));

function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** Climbing along a stretch of the route, laps and all, in 50 m steps. */
function climbBetween(route: Parameters<typeof gradeBetween>[0], a: number, b: number): number {
  let up = 0;
  for (let d = a; d < b; d += 50) {
    const g = gradeBetween(route, d, Math.min(b, d + 50));
    if (g > 0) up += g * (Math.min(b, d + 50) - d);
  }
  return up;
}

function RouteOverlay() {
  const [settings, set] = useSettings("route", DEFAULTS);
  const { address, watching, status } = useSauce({});
  const { course, route } = useCourse(address, watching);
  const s = watching?.state as (NonNullable<typeof watching>["state"] & { eventDistance?: number; laps?: number; climbing?: number; time?: number; routeDistance?: number }) | undefined;
  const subgroup = s?.eventSubgroupId || undefined;

  const [brief, setBrief] = useState<EventBrief | undefined>();
  useEffect(() => {
    setBrief(undefined);
    if (!subgroup) return;
    let live = true;
    void loadEventBrief(address, subgroup)
      .then((b) => live && setBrief(b))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [address, subgroup]);

  // How far: ridden (from the event's start banner in a race), to go, and the whole.
  const ridden = s?.eventDistance && s.eventDistance > 0 ? s.eventDistance : (s?.distance ?? 0);
  const toGo = watching?.remainingMetric === "distance" && watching.remaining != null ? Math.max(0, watching.remaining) : undefined;
  const timeLeft = watching?.remainingMetric === "time" && watching.remaining != null ? Math.max(0, watching.remaining) : undefined;
  const routeTotal = route ? route.leadinM + route.lapM * Math.max(1, brief?.laps ?? 1) : undefined;
  const total = toGo != null ? ridden + toGo : brief?.distanceKm ? brief.distanceKm * 1000 : routeTotal;
  const done = total ? Math.min(1, ridden / total) : timeLeft != null && brief?.durationMin ? 1 - timeLeft / (brief.durationMin * 60) : undefined;

  // Climbing: the route's whole, what's been climbed, and what's left between here and the line.
  const at = route ? routePosition(route, s) : undefined;
  const lapClimb = route ? climbBetween(route, route.leadinM, route.leadinM + route.lapM) : undefined;
  const leadClimb = route ? climbBetween(route, 0, route.leadinM) : undefined;
  const climbLeft = route && at != null && toGo != null ? climbBetween(route, at, at + toGo) : undefined;
  // Done plus left where both are known, so the two always add up; else the event's figure, else the route's.
  const totalClimb =
    climbLeft != null && s?.climbing != null
      ? s.climbing + climbLeft
      : (brief?.climbM ?? (lapClimb != null && leadClimb != null ? leadClimb + lapClimb * Math.max(1, brief?.laps ?? 1) : undefined));
  const gradeLeft = route && at != null && toGo != null && toGo > 200 ? gradeBetween(route, at, at + toGo) * 100 : undefined;

  // The lap: from the distance along the route past the lead-in.
  const laps = brief?.laps;
  const rd = s?.routeDistance;
  const lap = route && route.lapM > 0 && rd != null ? (rd < route.leadinM ? 0 : Math.floor((rd - route.leadinM) / route.lapM) + 1) : undefined;
  const leadinLeft = route && rd != null && rd < route.leadinM ? route.leadinM - rd : undefined;

  // Time, and the finish at the average speed so far.
  const elapsed = s?.time;
  const avgMs = elapsed && ridden ? ridden / elapsed : undefined;
  const eta = timeLeft ?? (toGo != null && avgMs ? toGo / avgMs : undefined);
  const finishAt = eta != null ? new Date(Date.now() + eta * 1000) : undefined;

  // What's coming: the next sprint or KOM ahead on the road, and the steepest kilometre to the line.
  const ahead = route && at != null ? route.segments.filter((x) => x.kind !== "segment" && x.start > at).sort((a, b) => a.start - b.start)[0] : undefined;
  let steepest: number | undefined;
  if (settings.steepest && route && at != null && toGo != null) {
    for (let d = at; d + 1000 <= at + toGo; d += 100) steepest = Math.max(steepest ?? -Infinity, gradeBetween(route, d, d + 1000) * 100);
  }

  const tiles: { label: string; value: string; unit?: string; sub?: string }[] = [];
  if (settings.distance && total) tiles.push({ label: "Distance", value: km(total), unit: "km", sub: `${km(ridden)} km ridden` });
  if (settings.remaining && (toGo != null || timeLeft != null))
    tiles.push(toGo != null ? { label: "To go", value: km(toGo), unit: "km" } : { label: "To go", value: clock(timeLeft!), sub: "time left" });
  if (settings.climbing && totalClimb != null)
    tiles.push({ label: "Climbing", value: String(Math.round(totalClimb)), unit: "m", sub: s?.climbing != null ? `${Math.round(s.climbing)} m done` : undefined });
  if (settings.climbLeft && climbLeft != null) tiles.push({ label: "Climbing left", value: String(Math.round(climbLeft)), unit: "m" });
  if (settings.gradeLeft && gradeLeft != null) tiles.push({ label: "Avg to the line", value: gradeLeft.toFixed(1), unit: "%" });
  if (settings.laps && lap != null && (laps ?? 0) > 1) tiles.push({ label: "Lap", value: lap === 0 ? "Lead-in" : `${Math.min(lap, laps!)}`, sub: `of ${laps}` });
  if (settings.leadin && route && route.leadinM > 0)
    tiles.push({ label: "Lead-in", value: km(route.leadinM), unit: "km", sub: leadinLeft != null ? `${km(leadinLeft)} km left` : "done" });
  if (settings.time && elapsed != null) tiles.push({ label: "Time", value: clock(elapsed) });
  if (settings.eta && eta != null && finishAt)
    tiles.push({
      label: "Finish in",
      value: clock(eta),
      sub: `about ${finishAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`,
    });
  if (settings.next && ahead && at != null)
    tiles.push({ label: ahead.kind === "sprint" ? "Next sprint" : "Next KOM", value: km(ahead.start - at), unit: "km", sub: ahead.name });
  if (settings.steepest && steepest != null && Number.isFinite(steepest)) tiles.push({ label: "Steepest km ahead", value: steepest.toFixed(1), unit: "%" });

  const name = route?.name ?? (status === "connected" ? (watching ? "Route not known to Sauce" : "Waiting for Zwift…") : "Connecting to Sauce…");

  return (
    <OverlayShell title="Route" settings={settings} setSetting={set} defs={DEFS}>
      <div className={`${shell.panel} ${styles.panel}`}>
        <header className={styles.head}>
          <span className={styles.name}>{name}</span>
          {settings.world && course?.worldName && <span className={styles.world}>{course.worldName}</span>}
          {settings.event && brief?.name && (
            <span className={styles.event}>
              {brief.name}
              {brief.label ? ` · ${brief.label}` : ""}
            </span>
          )}
        </header>
        {settings.bar && done != null && (
          <div className={styles.bar} title={`${Math.round(done * 100)}% done`}>
            <span style={{ width: `${done * 100}%` }} />
          </div>
        )}
        {tiles.length > 0 && (
          <dl className={styles.tiles}>
            {tiles.map((t) => (
              <div key={t.label} className={styles.tile}>
                <dt>{t.label}</dt>
                <dd>
                  {t.value}
                  {t.unit && <small>{t.unit}</small>}
                </dd>
                {t.sub && <span className={styles.sub}>{t.sub}</span>}
              </div>
            ))}
          </dl>
        )}
      </div>
    </OverlayShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Recover>
      <RouteOverlay />
    </Recover>
  </StrictMode>,
);
