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
import { chosen, display, gapIsEstimate, staminaLeft } from "./riderFields";
import shell from "./Overlay.module.css";
import styles from "./Riders.module.css";

// The riders in the rider's own group as cards, for a second screen: one
// per rider with their picture, flag, name and team, the gap, a W′ bar and
// whichever stats are chosen (riderFields) - the group around you at a
// glance, when it's small enough to show everyone.

const DEFAULTS = {
  opacity: 85,
  fields: "power,powerWkg,smooth60wkg,smooth300wkg,hr,cadence,speed,draft,np,tss",
  who: "group",
  within: 10,
  max: 10,
  category: true,
  wbar: true,
  sbar: false,
};
const DEFS: SettingDef[] = [
  {
    key: "who",
    label: "Riders",
    type: "select",
    options: [
      { value: "group", label: "My group" },
      { value: "near", label: "Everyone within a gap" },
    ],
  },
  {
    key: "within",
    label: "Gap, for everyone within",
    type: "select",
    options: [5, 10, 20, 30, 60].map((s) => ({ value: s, label: `${s} seconds` })),
  },
  { key: "max", label: "Most cards", type: "select", options: [4, 6, 8, 10, 12, 16].map((n) => ({ value: n, label: String(n) })) },
  { key: "category", label: "Only my category", type: "toggle" },
  { key: "wbar", label: "W′ balance bar", type: "toggle" },
  { key: "sbar", label: "Stamina bar", type: "toggle" },
];

function RidersOverlay() {
  const [settings, set] = useSettings("riders", DEFAULTS);
  const { address, nearby, groups, watching } = useSauce({ nearby: true, groups: true });
  const flags = useFlags(address);
  const fields = chosen(String(settings.fields));
  const subgroup = settings.category ? watching?.state?.eventSubgroupId || undefined : undefined;

  // The rider's group (as Sauce groups them), or everyone within the gap chosen.
  const mine = groups.find((g) => g.watching);
  const inGroup = new Set((mine?.athletes ?? []).map((a) => a.athleteId));
  let riders: SauceAthleteData[] = nearby.filter((r) => !subgroup || inRace(r, subgroup) || r.watching);
  riders =
    settings.who === "group" && inGroup.size
      ? riders.filter((r) => inGroup.has(r.athleteId) || r.watching)
      : riders.filter((r) => r.watching || (r.gap != null && Math.abs(r.gap) <= settings.within));
  // Too many: the nearest to the rider being watched, front to back.
  riders = riders
    .slice()
    .sort((a, b) => Math.abs(a.gap ?? 0) - Math.abs(b.gap ?? 0))
    .slice(0, settings.max)
    .sort((a, b) => (a.gap ?? 0) - (b.gap ?? 0));
  const myTeam = watching?.athlete?.team?.trim().toLowerCase();

  return (
    <OverlayShell
      title="Rider cards"
      settings={settings}
      setSetting={set}
      defs={DEFS}
      menuWidth={720}
      extraRows={18}
      extraSettings={<FieldPicker title="Stats on each card" value={String(settings.fields)} onChange={(v) => set("fields", v)} />}
    >
      <div className={styles.grid}>
        {riders.map((r) => {
          const a = r.athlete;
          const flag = a?.countryCode != null ? flags.get(a.countryCode) : undefined;
          const team = a?.team?.trim();
          const mate = !r.watching && !!myTeam && team?.toLowerCase() === myTeam;
          const wbal = settings.wbar && r.wBal != null ? Math.max(0, Math.min(1, r.wBal / (a?.wPrime || 20_000))) : undefined;
          const stamina = settings.sbar ? staminaLeft(r) : undefined;
          return (
            <article key={r.athleteId} className={`${shell.panel} ${styles.card} ${r.watching ? styles.me : ""} ${mate ? styles.mate : ""}`}>
              <header className={styles.head}>
                <Avatar r={r} />
                <span className={styles.who}>
                  <span className={styles.name}>
                    {flag && <img className={styles.flag} src={flag.src} alt={flag.name} title={flag.name} />}
                    {athleteName(r)}
                  </span>
                  {team && <span className={styles.team}>{team}</span>}
                </span>
                <span className={styles.gap}>
                  {r.watching ? "You" : r.gap == null ? "–" : `${r.gap > 0 ? "+" : "−"}${Math.abs(Math.round(r.gap))}s`}
                  {!r.watching && gapIsEstimate(r) && <small>est</small>}
                </span>
              </header>
              {wbal != null && (
                <div className={styles.bar} title={`W′ ${((r.wBal ?? 0) / 1000).toFixed(1)} kJ`}>
                  <span className={styles.barLabel}>W′</span>
                  <span className={styles.wbar}>
                    <span style={{ width: `${wbal * 100}%` }} className={wbal < 0.25 ? styles.low : ""} />
                  </span>
                  <span className={styles.barValue}>{Math.round(wbal * 100)}%</span>
                </div>
              )}
              {stamina != null && (
                <div className={styles.bar} title="Stamina left for the ride, from their normalised power and FTP - an estimate">
                  <span className={styles.barLabel}>Stamina</span>
                  <span className={`${styles.wbar} ${styles.stamina}`}>
                    <span style={{ width: `${stamina}%` }} className={stamina < 25 ? styles.low : ""} />
                  </span>
                  <span className={styles.barValue}>{Math.round(stamina)}%</span>
                </div>
              )}
              <dl className={styles.stats}>
                {fields.map((f) => (
                  <div key={f.id} className={styles.stat}>
                    <dt>{f.short}</dt>
                    <dd>{display(f, r)}</dd>
                  </div>
                ))}
              </dl>
            </article>
          );
        })}
        {riders.length === 0 && <p className={`${shell.panel} ${styles.empty}`}>No group around you yet.</p>}
      </div>
    </OverlayShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RidersOverlay />
  </StrictMode>,
);
