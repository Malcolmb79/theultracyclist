import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { OverlayShell, useSettings, type SettingDef } from "./overlay";
import { useSauce } from "./useSauce";
import shell from "./Overlay.module.css";
import styles from "./Groups.module.css";

// The groups on the road either side of the watched rider's - Zwift's row of
// group bubbles mid-screen - with each group's size, gap and pace.

const DEFAULTS = { opacity: 70, ahead: 3, behind: 2, gap: true, wkg: true, power: false };
const DEFS: SettingDef[] = [
  { key: "ahead", label: "Groups ahead", type: "select", options: [0, 1, 2, 3, 4].map((n) => ({ value: n, label: String(n) })) },
  { key: "behind", label: "Groups behind", type: "select", options: [0, 1, 2, 3].map((n) => ({ value: n, label: String(n) })) },
  { key: "gap", label: "Gaps", type: "toggle" },
  { key: "wkg", label: "Watts per kilo", type: "toggle" },
  { key: "power", label: "Average power", type: "toggle" },
];

function gapText(sec: number | undefined): string {
  if (sec == null) return "";
  const abs = Math.abs(sec);
  const t = abs < 60 ? `${Math.round(abs)}s` : `${Math.floor(abs / 60)}:${String(Math.round(abs % 60)).padStart(2, "0")}`;
  return `${sec < 0 ? "−" : "+"}${t}`;
}

function GroupsOverlay() {
  const [settings, set] = useSettings("groups", DEFAULTS);
  const { groups, status } = useSauce({ groups: true });
  const i = groups.findIndex((g) => g.watching);
  const shown = i < 0 ? [] : groups.slice(Math.max(0, i - settings.ahead), i + 1 + settings.behind);

  return (
    <OverlayShell title="Groups" settings={settings} setSetting={set} defs={DEFS}>
      <div className={styles.row}>
        {shown.length === 0 && <span className={`${shell.panel} ${styles.empty}`}>{status === "connected" ? "No groups yet" : "Connecting…"}</span>}
        {shown.map((g, k) => {
          const size = g.athletes?.length ?? 0;
          const wkg = g.power && g.weight ? g.power / g.weight : undefined;
          return (
            <div key={g.id ?? k} className={`${styles.group} ${g.watching ? styles.mine : ""}`}>
              {k > 0 && <span className={styles.link} aria-hidden />}
              <span className={styles.bubble} style={{ ["--size" as string]: String(Math.min(1, Math.log2(size + 1) / 5)) }}>
                {size}
              </span>
              <span className={styles.meta}>
                {settings.gap && !g.watching && <b>{gapText(g.gap)}</b>}
                {settings.wkg && wkg != null && <span>{wkg.toFixed(1)} W/kg</span>}
                {settings.power && g.power != null && <span>{Math.round(g.power)} W</span>}
              </span>
            </div>
          );
        })}
      </div>
    </OverlayShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <GroupsOverlay />
  </StrictMode>,
);
