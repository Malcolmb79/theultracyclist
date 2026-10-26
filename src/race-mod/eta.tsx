import { StrictMode, useRef } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { OverlayShell, useSettings, type SettingDef } from "./overlay";
import { useSauce } from "./useSauce";
import { routePosition, useCourse } from "./useCourse";
import { BIKE_KG, calibrateCdA, gradeBetween, speedFor, timeAhead } from "./physics";
import shell from "./Overlay.module.css";
import tool from "./Tool.module.css";

// When the rider will finish, the way a bike computer's estimated time to
// destination works but taking the road into account: the rest of the
// route ridden at their recent power, slice by slice - slower on the
// climbs still to come, faster down the descents - at the speed their
// own riding says that power gives (draft included). A time-based event
// gets the distance they'll have covered at the end instead.

const DEFAULTS = { opacity: 80, window: 300, clock: true };
const DEFS: SettingDef[] = [
  {
    key: "window",
    label: "Power to predict from",
    type: "select",
    options: [
      { value: 60, label: "Last minute" },
      { value: 300, label: "Last 5 minutes" },
      { value: 1200, label: "Last 20 minutes" },
    ],
  },
  { key: "clock", label: "Finish time of day", type: "toggle" },
];

function span(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${m}:${String(ss).padStart(2, "0")}`;
}

function EtaOverlay() {
  const [settings, set] = useSettings("eta", DEFAULTS);
  const { address, watching, status } = useSauce({});
  const { route } = useCourse(address, watching);
  const history = useRef<{ t: number; w: number; v: number; g: number }[]>([]);
  const cdA = useRef<number | undefined>(undefined);

  const s = watching?.state;
  const now = Date.now();
  if (s?.power != null && history.current.at(-1)?.t !== now) {
    history.current = [...history.current, { t: now, w: s.power, v: s.speed ?? 0, g: s.grade ?? 0 }].filter((x) => now - x.t <= 1_200_000);
  }
  const recent = history.current.filter((x) => now - x.t <= settings.window * 1000);
  const watts = recent.length ? recent.reduce((a, x) => a + x.w, 0) / recent.length : undefined;
  const mass = (watching?.athlete?.weight || 75) + BIKE_KG;
  // The rider's drag, from the last half minute of riding, smoothed.
  const last30 = history.current.filter((x) => now - x.t <= 30_000);
  if (last30.length >= 10) {
    const avg = (f: (x: (typeof last30)[number]) => number) => last30.reduce((a, x) => a + f(x), 0) / last30.length;
    const fresh = calibrateCdA(avg((x) => x.w), avg((x) => x.v), avg((x) => x.g), mass);
    if (fresh != null) cdA.current = cdA.current == null ? fresh : cdA.current * 0.9 + fresh * 0.1;
  }

  const at = route ? routePosition(route, s) : undefined;
  const ready = route && at != null && watts != null && cdA.current != null && watching?.remaining != null && watching.remaining > 0;
  let line: { big: string; sub: string; clock?: string } | null = null;
  if (ready) {
    if (watching!.remainingMetric === "time") {
      // How far the rest of the time takes them.
      let left = watching!.remaining!;
      let d = 0;
      while (left > 0 && d < 200_000) {
        const v = Math.max(1.5, speedFor(watts!, gradeBetween(route!, at! + d, at! + d + 50), mass, cdA.current!));
        left -= 50 / v;
        d += 50;
      }
      line = { big: `${(d / 1000).toFixed(1)} km`, sub: `more by the finish, at ${Math.round(watts!)} W` };
    } else {
      const secs = timeAhead(route!, at!, watching!.remaining!, watts!, mass, cdA.current!);
      const finish = new Date(Date.now() + secs * 1000);
      line = {
        big: span(secs),
        sub: `to the finish, at ${Math.round(watts!)} W`,
        clock: finish.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
    }
  }

  return (
    <OverlayShell title="Finish prediction" settings={settings} setSetting={set} defs={DEFS}>
      <div className={`${shell.panel} ${tool.panel}`}>
        {!line ? (
          <p className={tool.waiting}>
            {status !== "connected"
              ? "Connecting to Sauce…"
              : watching?.remaining == null
                ? "Predicts the finish in an event."
                : "Working out your pace…"}
          </p>
        ) : (
          <>
            <div className={tool.top}>
              <span className={tool.label}>Finish</span>
              {settings.clock && line.clock && <span className={tool.tag}>at {line.clock}</span>}
            </div>
            <div className={tool.big}>{line.big}</div>
            <p className={tool.line}>{line.sub}</p>
            <p className={`${tool.line} ${tool.muted}`}>Taking in the climbs and descents to come.</p>
          </>
        )}
      </div>
    </OverlayShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <EtaOverlay />
  </StrictMode>,
);
