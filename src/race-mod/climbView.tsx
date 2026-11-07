import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { OverlayShell, useSettings, type SettingDef } from "./overlay";
import { useSauce } from "./useSauce";
import { routePosition, useCourse } from "./useCourse";
import { CLIMB_DEFAULTS, ClimbCard, useClimb } from "./climbCard";
import styles from "./ClimbView.module.css";

// The climb pop-up Zwift shows on a climb: it appears as the road starts to
// rise (or just before, if chosen), shows the gradient now, what's left to
// the top and a profile of the climb shaded by steepness, and goes once the
// rider is over the top.

const DEFAULTS = { opacity: 80, ...CLIMB_DEFAULTS };
const DEFS: SettingDef[] = [
  {
    key: "sensitivity",
    label: "Pops up for",
    type: "select",
    options: [
      { value: "zwift", label: "Every rise, like Zwift" },
      { value: "standard", label: "Proper climbs" },
      { value: "big", label: "Big climbs only" },
    ],
  },
  {
    key: "ahead",
    label: "Show before the climb",
    type: "select",
    options: [
      { value: 0, label: "Only on it" },
      { value: 300, label: "300 m out" },
      { value: 1000, label: "1 km out" },
    ],
  },
  { key: "profile", label: "Climb profile", type: "toggle" },
  { key: "average", label: "Average gradient", type: "toggle" },
  { key: "height", label: "Height to go", type: "toggle" },
  { key: "progress", label: "Progress bar", type: "toggle" },
  { key: "steepest", label: "Steepest pitch", type: "toggle" },
];

function ClimbOverlay() {
  const [settings, set] = useSettings("climb", DEFAULTS);
  const { address, watching } = useSauce({});
  const { route } = useCourse(address, watching);
  const s = watching?.state;
  const at = route ? routePosition(route, s) : undefined;

  // Like Zwift's: once a climb is picked up it's fixed - the same start,
  // top and profile - until the rider is over the top and a little beyond,
  // rather than worked out again every second (which shifted its shape and
  // colours as the rise's edges moved). Only then is the next one looked for.
  const gradeNow = s?.grade != null ? s.grade * 100 : undefined;
  const climb = useClimb(route, at, settings, gradeNow);

  return (
    <OverlayShell title="Climb pop-up" settings={settings} setSetting={set} defs={DEFS}>
      {climb && route && at != null ? (
        <ClimbCard route={route} at={at} climb={climb} gradeNow={gradeNow} settings={settings} />
      ) : (
        // Nothing to show: an empty window that still takes a right-click.
        <div className={styles.idle}>Climb pop-up appears on climbs · right-click for settings</div>
      )}
    </OverlayShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ClimbOverlay />
  </StrictMode>,
);
