import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { OverlayShell, useSettings, type SettingDef } from "./overlay";
import { useSauce } from "./useSauce";
import { routePosition, useCourse } from "./useCourse";
import ProfileChart, { type ProfileRider } from "./ProfileChart";
import styles from "./Profile.module.css";

// The route profile along the bottom of the screen, as Zwift has it: the
// road's elevation with its sprints and climbs, the riders on it, the
// segment being ridden or coming up, and the distance to the finish.

const DEFAULTS = {
  opacity: 75,
  window: 0,
  riders: true,
  segments: true,
  segmentNames: true,
  banner: true,
  toGo: true,
  gradient: true,
};
const DEFS: SettingDef[] = [
  {
    key: "window",
    label: "Show",
    type: "select",
    options: [
      { value: 0, label: "Whole route" },
      { value: 5000, label: "Next 5 km" },
      { value: 10000, label: "Next 10 km" },
      { value: 20000, label: "Next 20 km" },
    ],
  },
  { key: "riders", label: "Riders", type: "toggle" },
  { key: "segments", label: "Sprints & climbs", type: "toggle" },
  { key: "segmentNames", label: "Segment names", type: "toggle" },
  { key: "banner", label: "Segment banner", type: "toggle" },
  { key: "toGo", label: "Distance to finish", type: "toggle" },
  { key: "gradient", label: "Gradient", type: "toggle" },
];

const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);

function ProfileOverlay() {
  const [settings, set] = useSettings("profile", DEFAULTS);
  const { address, status, watching, nearby } = useSauce({ nearby: true });
  const { route, problem } = useCourse(address, watching);
  const s = watching?.state;
  const at = route ? routePosition(route, s?.routeDistance) : undefined;
  const myTeam = watching?.athlete?.team?.trim().toLowerCase();
  const riders: ProfileRider[] =
    route && settings.riders
      ? nearby.flatMap((r) => {
          const p = routePosition(route, r.state?.routeDistance);
          return p == null
            ? []
            : [{ id: r.athleteId, at: p, watching: r.watching, teammate: !!myTeam && r.athlete?.team?.trim().toLowerCase() === myTeam }];
        })
      : [];

  // The segment being ridden, or the next one.
  const current = route && at != null ? route.segments.find((x) => at >= x.start && at <= x.end) : undefined;
  const next = route && at != null && !current ? route.segments.filter((x) => x.start > at).sort((a, b) => a.start - b.start)[0] : undefined;
  const toGo =
    watching?.remaining == null
      ? null
      : watching.remainingMetric === "time"
        ? `${Math.max(0, Math.round(watching.remaining / 60))} min to go`
        : `${km(Math.max(0, watching.remaining))} to finish`;

  return (
    <OverlayShell title="Route profile" settings={settings} setSetting={set} defs={DEFS}>
      <div className={styles.panel}>
        {(settings.banner || settings.toGo || settings.gradient) && (
          <div className={styles.top}>
            {settings.banner && current && at != null && (
              <span className={`${styles.banner} ${styles[current.kind]}`}>
                {current.name}: {((at - current.start) / 1000).toFixed(2)} / {((current.end - current.start) / 1000).toFixed(2)} km
                <span className={styles.progress} style={{ width: `${((at - current.start) / (current.end - current.start)) * 100}%` }} />
              </span>
            )}
            {settings.banner && next && at != null && (
              <span className={styles.next}>
                {next.name} in {km(next.start - at)}
              </span>
            )}
            <span className={styles.spacer} />
            {settings.gradient && s?.grade != null && <span className={styles.grade}>{(s.grade * 100).toFixed(1)}%</span>}
            {settings.toGo && toGo && <span className={styles.toGo}>{toGo}</span>}
          </div>
        )}
        <div className={styles.chart}>
          {route ? (
            <ProfileChart
              route={route}
              at={at}
              riders={riders}
              windowM={settings.window || undefined}
              showSegments={settings.segments}
              showSegmentNames={settings.segmentNames}
            />
          ) : (
            <p className={styles.empty}>{problem ?? (status === "connected" ? "Waiting for a route…" : "Connecting to Sauce…")}</p>
          )}
        </div>
      </div>
    </OverlayShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ProfileOverlay />
  </StrictMode>,
);
