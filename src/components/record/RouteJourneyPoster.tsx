import { ISLAND_PATH } from "./IrelandRouteMap";
import { record } from "../../data/record";
import { site } from "../../data/site";
import styles from "./RouteJourneyPoster.module.css";

// Same start/end coordinates (in the island path's own coordinate space) as
// IrelandRouteMap -- kept in sync manually since there are only two points.
const MALIN_HEAD = { x: 138.6, y: 56.6 };
const MIZEN_HEAD = { x: 28.1, y: 343.4 };
const ROUTE_CONTROL = { x: 110, y: 190 };

function quadraticPoint(t: number) {
  const mt = 1 - t;
  return {
    x: mt * mt * MALIN_HEAD.x + 2 * mt * t * ROUTE_CONTROL.x + t * t * MIZEN_HEAD.x,
    y: mt * mt * MALIN_HEAD.y + 2 * mt * t * ROUTE_CONTROL.y + t * t * MIZEN_HEAD.y,
  };
}

// Waypoints are illustrative (a plausible north-south corridor), not a
// certified GPS route -- distances are proportional estimates along our
// simplified curve, not measured road distance.
const WAYPOINTS = [
  { t: 0.16, name: "Letterkenny" },
  { t: 0.36, name: "Sligo" },
  { t: 0.56, name: "Athlone" },
  { t: 0.76, name: "Limerick" },
  { t: 0.9, name: "Cork" },
];

const GROUP_TRANSFORM = "translate(620,420) rotate(24) scale(2.22) translate(-110.25,-200)";

export default function RouteJourneyPoster() {
  return (
    <div className={styles.wrap}>
      <svg
        className={styles.svg}
        viewBox="0 0 1000 750"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="Stylized map of the planned Ireland north-to-south route, from Malin Head to Mizen Head"
      >
        <defs>
          <radialGradient id="posterBg" cx="60%" cy="35%" r="75%">
            <stop offset="0%" stopColor="#161b21" />
            <stop offset="100%" stopColor="#05070a" />
          </radialGradient>

          <pattern id="hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="0" y2="6" stroke="#ffffff" strokeWidth="1" />
          </pattern>

          <linearGradient id="islandFill" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#2a323c" />
            <stop offset="100%" stopColor="#12161b" />
          </linearGradient>

          <linearGradient id="routeGlowGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent-2)" />
            <stop offset="100%" stopColor="var(--color-accent)" />
          </linearGradient>

          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <clipPath id="islandClip">
            <path d={ISLAND_PATH} />
          </clipPath>
        </defs>

        <rect x="0" y="0" width="1000" height="750" fill="url(#posterBg)" />
        <rect x="0" y="0" width="1000" height="750" fill="url(#hatch)" opacity="0.035" />

        <g transform={GROUP_TRANSFORM}>
          <path d={ISLAND_PATH} fill="url(#islandFill)" stroke="#3a4451" strokeWidth="1" />
          <path d={ISLAND_PATH} fill="url(#hatch)" opacity="0.12" clipPath="url(#islandClip)" />

          <path
            d={`M${MALIN_HEAD.x},${MALIN_HEAD.y} Q${ROUTE_CONTROL.x},${ROUTE_CONTROL.y} ${MIZEN_HEAD.x},${MIZEN_HEAD.y}`}
            fill="none"
            stroke="url(#routeGlowGradient)"
            strokeWidth="3.2"
            strokeLinecap="round"
            filter="url(#glow)"
          />

          <circle cx={MALIN_HEAD.x} cy={MALIN_HEAD.y} r="3.2" fill="var(--color-accent-2)" />
          <circle cx={MIZEN_HEAD.x} cy={MIZEN_HEAD.y} r="3.2" fill="var(--color-accent)" />

          {WAYPOINTS.map((wp) => {
            const p = quadraticPoint(wp.t);
            return <circle key={wp.name} cx={p.x} cy={p.y} r="1.6" fill="var(--color-text)" opacity="0.8" />;
          })}
        </g>
      </svg>

      <div className={styles.overlay}>
        <div className={styles.titleLine}>Ireland</div>
        <div className={styles.titleLine}>North to South</div>
        <div className={styles.eyebrowLine}>World record attempt</div>
        <div className={styles.divider} />
        <div className={styles.statsGrid}>
          <div>
            <div className={styles.statLabel}>Target distance</div>
            <div className={styles.statValue}>{record.distanceKm} km</div>
          </div>
          <div>
            <div className={styles.statLabel}>Rider</div>
            <div className={styles.statValue}>{site.athleteName}</div>
          </div>
          <div>
            <div className={styles.statLabel}>Route</div>
            <div className={styles.statValue}>Malin Head &rarr; Mizen Head</div>
          </div>
          <div>
            <div className={styles.statLabel}>Raising funds for</div>
            <div className={styles.statValue}>{site.charityName}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
