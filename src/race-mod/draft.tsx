import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { OverlayShell, useSettings, type SettingDef } from "./overlay";
import { useSauce } from "./useSauce";
import shell from "./Overlay.module.css";
import styles from "./Draft.module.css";

// The draft: how much shelter the rider is getting right now, as the watts
// the draft is saving them, with a gauge, a minute's history, and the
// energy it has saved so far.

const DEFAULTS = { opacity: 80, gauge: true, history: true, share: true, energy: true, average: false };
const DEFS: SettingDef[] = [
  { key: "gauge", label: "Gauge", type: "toggle" },
  { key: "history", label: "Last minute", type: "toggle" },
  { key: "share", label: "Share of your power", type: "toggle" },
  { key: "energy", label: "Energy saved", type: "toggle" },
  { key: "average", label: "Average", type: "toggle" },
];

/** A big draft in Zwift is worth around this many watts; the gauge fills to it. */
const GAUGE_FULL_W = 200;
const HISTORY_S = 60;

function shelter(w: number): { label: string; color: string } {
  if (w < 10) return { label: "In the wind", color: "#ff4d2e" };
  if (w < 50) return { label: "Some shelter", color: "#ffd23f" };
  if (w < 110) return { label: "Sheltered", color: "#2ee6a6" };
  return { label: "Deep in the wheels", color: "#2ee6a6" };
}

function DraftOverlay() {
  const [settings, set] = useSettings("draft", DEFAULTS);
  const { watching } = useSauce({});
  const [history, setHistory] = useState<number[]>([]);
  const s = watching?.state;
  const draft = s?.draft;

  useEffect(() => {
    if (draft == null) return;
    setHistory((h) => [...h, draft].slice(-HISTORY_S));
    // Every update adds a point, not just a change in draft.
  }, [watching, draft]);

  const now = draft ?? 0;
  const look = shelter(now);
  const power = s?.power;
  // Without the draft the same speed would need roughly power + draft.
  const share = power != null && power + now > 0 ? Math.round((now / (power + now)) * 100) : undefined;
  const max = Math.max(GAUGE_FULL_W, ...history);
  const line = history
    .map((w, i) => `${i ? "L" : "M"}${((i / Math.max(1, HISTORY_S - 1)) * 100).toFixed(1)} ${(40 - (w / max) * 36).toFixed(1)}`)
    .join("");

  return (
    <OverlayShell title="Draft" settings={settings} setSetting={set} defs={DEFS}>
      <div className={`${shell.panel} ${styles.panel}`} style={{ borderColor: look.color }}>
        <div className={styles.top}>
          <span className={styles.label}>Draft</span>
          <span className={styles.state} style={{ color: look.color }}>
            {draft == null ? "–" : look.label}
          </span>
        </div>
        <div className={styles.main}>
          <span className={styles.watts}>{draft != null ? Math.round(now) : "–"}</span>
          <span className={styles.unit}>W saved</span>
          {settings.share && share != null && <span className={styles.share}>{share}%</span>}
        </div>
        {settings.gauge && (
          <div className={styles.gauge} aria-hidden>
            <span style={{ width: `${Math.min(100, (now / GAUGE_FULL_W) * 100)}%`, background: look.color }} />
          </div>
        )}
        {settings.history && history.length > 1 && (
          <svg viewBox="0 0 100 40" preserveAspectRatio="none" className={styles.history} aria-hidden>
            <path d={`${line}L${(((history.length - 1) / Math.max(1, HISTORY_S - 1)) * 100).toFixed(1)} 40L0 40Z`} className={styles.area} />
            <path d={line} className={styles.line} vectorEffect="non-scaling-stroke" />
          </svg>
        )}
        {(settings.energy || settings.average) && (
          <div className={styles.foot}>
            {settings.energy && watching?.stats?.draft?.kj != null && <span>{Math.round(watching.stats.draft.kj)} kJ saved</span>}
            {settings.average && watching?.stats?.draft?.avg != null && <span>{Math.round(watching.stats.draft.avg)} W average</span>}
          </div>
        )}
      </div>
    </OverlayShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DraftOverlay />
  </StrictMode>,
);
