import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { athleteName, type SauceAthleteData } from "../components/race/sauceFeed";
import { inRace } from "../components/race/sameRace";
import { OverlayShell, useSettings, type SettingDef } from "./overlay";
import { useSauce } from "./useSauce";
import { useFlags } from "./flags";
import FieldPicker from "./FieldPicker";
import { Avatar } from "./nearbyAvatar";
import { chosen, display, gapIsEstimate, type RiderField } from "./riderFields";
import shell from "./Overlay.module.css";
import styles from "./Nearby.module.css";

// The riders around, as a table like Sauce's Nearby Athletes - avatar, flag,
// name and team, then whichever columns are chosen from everything Sauce
// knows about each rider (riderFields) - in the overlays' look. Click a
// heading to sort by it; the rider being watched is picked out.

const DEFAULT_COLUMNS = "gap,power,powerWkg,avg,np,speed,hr,maxPower,smooth5wkg,wbal,smooth15wkg,smooth60wkg,smooth300wkg,smooth1200wkg,tss";

const DEFAULTS = {
  opacity: 80,
  columns: DEFAULT_COLUMNS,
  avatars: true,
  flags: true,
  teams: true,
  category: true,
  rows: 20,
  sortBy: "gap",
  sortDown: false,
};
const DEFS: SettingDef[] = [
  { key: "category", label: "Only my category", type: "toggle" },
  { key: "rows", label: "Riders shown", type: "select", options: [5, 10, 20, 40, 80].map((n) => ({ value: n, label: String(n) })) },
  { key: "avatars", label: "Pictures", type: "toggle" },
  { key: "flags", label: "Flags", type: "toggle" },
  { key: "teams", label: "Team tags", type: "toggle" },
];

function sortValue(r: SauceAthleteData, f: RiderField | undefined): number | string {
  const v = f?.value(r);
  return v == null ? Number.NEGATIVE_INFINITY : v;
}

function NearbyOverlay() {
  const [settings, set] = useSettings("nearby", DEFAULTS);
  const { address, nearby, watching } = useSauce({ nearby: true });
  const flags = useFlags(address);
  const columns = chosen(String(settings.columns));
  const sortField = columns.find((c) => c.id === settings.sortBy) ?? columns.find((c) => c.id === "gap");
  const subgroup = settings.category ? watching?.state?.eventSubgroupId || undefined : undefined;

  let riders = nearby.filter((r) => !subgroup || inRace(r, subgroup));
  riders = riders.slice().sort((a, b) => {
    const x = sortValue(a, sortField);
    const y = sortValue(b, sortField);
    const d = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    // Gap reads front to back by default; everything else biggest first.
    const down = sortField?.id === "gap" ? settings.sortDown : !settings.sortDown;
    return down ? -d : d;
  });
  // Too many to show: the ones nearest the rider being watched.
  if (riders.length > settings.rows) {
    const me = riders.findIndex((r) => r.watching);
    const start = me < 0 ? 0 : Math.max(0, Math.min(riders.length - settings.rows, me - Math.floor(settings.rows / 2)));
    riders = riders.slice(start, start + settings.rows);
  }
  const myTeam = watching?.athlete?.team?.trim().toLowerCase();

  const sortBy = (id: string) => (settings.sortBy === id ? set("sortDown", !settings.sortDown) : (set("sortBy", id), set("sortDown", false)));

  return (
    <OverlayShell
      title="Nearby riders"
      settings={settings}
      setSetting={set}
      defs={DEFS}
      menuWidth={720}
      extraRows={18}
      extraSettings={<FieldPicker title="Columns" value={String(settings.columns)} onChange={(v) => set("columns", v)} />}
    >
      <div className={`${shell.panel} ${styles.panel}`}>
        <table className={styles.table}>
          <thead>
            <tr>
              {settings.avatars && <th aria-label="Picture" />}
              {settings.flags && <th aria-label="Flag" />}
              <th className={styles.nameCol}>Name</th>
              {columns.map((c) => (
                <th key={c.id} className={`${styles.num} ${settings.sortBy === c.id ? styles.sorted : ""}`} onClick={() => sortBy(c.id)} title={c.label}>
                  {c.short}
                  {settings.sortBy === c.id && <span className={styles.arrow}>{(c.id === "gap" ? settings.sortDown : !settings.sortDown) ? "▼" : "▲"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {riders.map((r) => {
              const flag = settings.flags && r.athlete?.countryCode != null ? flags.get(r.athlete.countryCode) : undefined;
              const team = r.athlete?.team?.trim();
              const mate = !r.watching && !!myTeam && team?.toLowerCase() === myTeam;
              return (
                <tr key={r.athleteId} className={`${r.watching ? styles.me : ""} ${mate ? styles.mate : ""}`}>
                  {settings.avatars && (
                    <td>
                      <Avatar r={r} />
                    </td>
                  )}
                  {settings.flags && <td>{flag && <img className={styles.flag} src={flag.src} alt={flag.name} title={flag.name} />}</td>}
                  <td className={styles.nameCol}>
                    <span className={styles.name}>{athleteName(r)}</span>
                    {settings.teams && team && <span className={styles.team}>{team}</span>}
                  </td>
                  {columns.map((c) => (
                    <td key={c.id} className={styles.num}>
                      {display(c, r)}
                      {c.id === "gap" && gapIsEstimate(r) && <small> est</small>}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {riders.length === 0 && <p className={styles.empty}>No riders nearby yet.</p>}
      </div>
    </OverlayShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <NearbyOverlay />
  </StrictMode>,
);
