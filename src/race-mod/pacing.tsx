import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { OverlayShell, useSettings, type SettingDef } from "./overlay";
import { useSauce } from "./useSauce";
import { routePosition, useCourse } from "./useCourse";
import { gradeBetween } from "./physics";
import shell from "./Overlay.module.css";
import tool from "./Tool.module.css";

// A pacing plan, like a bike computer's power guide: an average power to
// ride the route at, turned into a target for the road under the wheels -
// harder up the climbs, where the time is won, easier on the flat and a
// recovery down the descents - with how the rider is doing against it now
// and against the plan so far, and what's next.

const DEFAULTS = { opacity: 80, target: 0.85, hills: 6 };
const DEFS: SettingDef[] = [
  {
    key: "target",
    label: "Plan for",
    type: "select",
    options: [
      { value: 0.65, label: "65% of FTP (endurance)" },
      { value: 0.75, label: "75% of FTP (tempo-ish)" },
      { value: 0.85, label: "85% of FTP (sweet spot)" },
      { value: 0.95, label: "95% of FTP (threshold TT)" },
      { value: 1.0, label: "100% of FTP (short TT)" },
    ],
  },
  {
    key: "hills",
    label: "Push the climbs",
    type: "select",
    options: [
      { value: 0, label: "No - steady all the way" },
      { value: 4, label: "A little" },
      { value: 6, label: "Yes (recommended)" },
      { value: 9, label: "Hard" },
    ],
  },
];

/** How far ahead the road is read for the target now, and for what's coming. */
const NOW_M = 100;
const NEXT_M = 1000;

/** The target for a gradient (fraction): up with the road, a recovery down the descents. */
function targetFor(base: number, grade: number, hills: number): number {
  const pct = grade * 100;
  if (pct <= -2) return base * 0.65;
  return base * Math.max(0.8, Math.min(1.25, 1 + (hills / 100) * pct));
}

function PacingOverlay() {
  const [settings, set] = useSettings("pacing", DEFAULTS);
  const { address, watching, status } = useSauce({});
  const { route } = useCourse(address, watching);
  // Power against the plan since the overlay started following this rider.
  const [tally, setTally] = useState({ id: -1, w: 0, target: 0, n: 0 });
  const recent = useRef<number[]>([]);

  const s = watching?.state;
  const ftp = watching?.athlete?.ftp ?? undefined;
  const at = route ? routePosition(route, s) : undefined;
  const base = ftp ? ftp * settings.target : undefined;
  const gradeNow = route && at != null ? gradeBetween(route, at, at + NOW_M) : (s?.grade ?? 0);
  const now = base != null ? targetFor(base, gradeNow, settings.hills) : undefined;

  // The next change: the first stretch ahead whose target differs by more than 5%.
  let next: { inM: number; grade: number; target: number } | undefined;
  if (route && at != null && base != null && now != null) {
    for (let d = NOW_M; d <= NEXT_M * 3; d += 100) {
      const g = gradeBetween(route, at + d, at + d + 200);
      const t = targetFor(base, g, settings.hills);
      if (Math.abs(t - now) / now > 0.05) {
        next = { inM: d, grade: g, target: t };
        break;
      }
    }
  }

  useEffect(() => {
    if (s?.power == null || now == null || watching == null) return;
    recent.current = [...recent.current, s.power].slice(-5);
    setTally((t) => (t.id === watching.athleteId ? { ...t, w: t.w + s.power!, target: t.target + now, n: t.n + 1 } : { id: watching.athleteId, w: s.power!, target: now, n: 1 }));
    // Each update is a second of riding against the plan.
  }, [watching]); // eslint-disable-line react-hooks/exhaustive-deps

  const smooth = recent.current.length ? recent.current.reduce((a, b) => a + b, 0) / recent.current.length : undefined;
  const off = smooth != null && now != null ? smooth - now : undefined;
  const offClass = off == null ? "" : Math.abs(off) <= now! * 0.05 ? tool.good : off > 0 ? tool.bad : tool.warn;
  const planPct = tally.n > 30 ? Math.round((tally.w / tally.target) * 100) : null;

  return (
    <OverlayShell title="Pacing plan" settings={settings} setSetting={set} defs={DEFS}>
      <div className={`${shell.panel} ${tool.panel}`}>
        {!ftp || now == null ? (
          <p className={tool.waiting}>{status === "connected" ? "Needs the rider's FTP from Zwift." : "Connecting to Sauce…"}</p>
        ) : (
          <>
            <div className={tool.top}>
              <span className={tool.label}>Target</span>
              <span className={tool.tag}>
                {(gradeNow * 100).toFixed(1)}% road
              </span>
            </div>
            <div className={tool.big}>
              {Math.round(now)}
              <small>W</small>
            </div>
            {off != null && (
              <p className={`${tool.line} ${offClass}`}>
                {Math.abs(off) <= now * 0.05 ? "On target" : off > 0 ? `${Math.round(off)} W over - ease off` : `${Math.round(-off)} W under`}
              </p>
            )}
            {next && (
              <p className={tool.line}>
                In {next.inM >= 1000 ? `${(next.inM / 1000).toFixed(1)} km` : `${next.inM} m`}: {Math.round(next.target)} W ({(next.grade * 100).toFixed(1)}%)
              </p>
            )}
            {planPct != null && <p className={`${tool.line} ${tool.muted}`}>So far: {planPct}% of the plan</p>}
          </>
        )}
      </div>
    </OverlayShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PacingOverlay />
  </StrictMode>,
);
