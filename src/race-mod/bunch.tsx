import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { cleanName } from "../components/race/sauceFeed";
import { sameRaceGroups } from "../components/race/sameRace";
import { OverlayShell, useSettings, type SettingDef } from "./overlay";
import { useSauce } from "./useSauce";
import shell from "./Overlay.module.css";
import tool from "./Tool.module.css";
import styles from "./Bunch.module.css";

// Where the rider is in their bunch, front to back - how many wheels from
// the front, and whether that's the front, the middle or the back - which
// Zwift doesn't show and which matters going into a climb or a sprint.
// Each rider in the group is a dot along the bunch by their gap.

const DEFAULTS = { opacity: 80, category: true, wheels: true };
const DEFS: SettingDef[] = [
  { key: "category", label: "Only my category", type: "toggle" },
  { key: "wheels", label: "Riders in front of me", type: "toggle" },
];

function BunchOverlay() {
  const [settings, set] = useSettings("bunch", DEFAULTS);
  const { groups: all, watching, status } = useSauce({ groups: true });
  const groups = sameRaceGroups(all, settings.category ? watching?.state?.eventSubgroupId || undefined : undefined);
  const group = groups.find((g) => g.watching);
  // Front first: the most negative gap is furthest up the road.
  const riders = (group?.athletes ?? []).slice().sort((a, b) => (a.gap ?? 0) - (b.gap ?? 0));
  // The rider by their id as well as the flag, which isn't always set on group members.
  const me = riders.findIndex((r) => r.watching || r.athleteId === watching?.athleteId);
  const size = riders.length;
  const spread = size > 1 ? Math.max(0.5, (riders[size - 1].gap ?? 0) - (riders[0].gap ?? 0)) : 1;
  const where = me < 0 || size < 2 ? null : me / (size - 1);
  const zone = where == null ? "" : where <= 0.2 ? "Front" : where >= 0.75 ? "Back" : "Middle";
  const zoneClass = zone === "Front" ? tool.good : zone === "Back" ? tool.bad : tool.warn;
  const ahead = me >= 0 ? riders.slice(Math.max(0, me - 2), me).map((r) => cleanName(r.athlete?.lastName) || `Rider ${r.athleteId}`) : [];

  return (
    <OverlayShell title="Bunch position" settings={settings} setSetting={set} defs={DEFS}>
      <div className={`${shell.panel} ${tool.panel}`}>
        {me < 0 ? (
          <p className={tool.waiting}>{status === "connected" ? "Waiting for your group…" : "Connecting to Sauce…"}</p>
        ) : size < 2 ? (
          <p className={tool.waiting}>Riding on your own.</p>
        ) : (
          <>
            <div className={tool.top}>
              <span className={tool.label}>Bunch</span>
              <span className={`${tool.tag} ${zoneClass}`}>{zone}</span>
            </div>
            <div className={tool.big}>
              {me === 0 ? "Front" : `${me + 1}`}
              {me > 0 && <small>of {size}</small>}
            </div>
            {/* The bunch, front on the right as the race runs. */}
            <div className={styles.lane} aria-hidden>
              {riders.map((r, i) => (
                <span
                  key={r.athleteId}
                  className={`${styles.dot} ${i === me ? styles.me : ""}`}
                  style={{ left: `${100 - (((r.gap ?? 0) - (riders[0].gap ?? 0)) / spread) * 100}%` }}
                />
              ))}
              <span className={styles.front}>front ▶</span>
            </div>
            {settings.wheels && me > 0 && (
              <p className={tool.line}>
                {me} {me === 1 ? "wheel" : "wheels"} from the front{ahead.length ? ` · behind ${ahead.join(", ")}` : ""}
              </p>
            )}
          </>
        )}
      </div>
    </OverlayShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BunchOverlay />
  </StrictMode>,
);
