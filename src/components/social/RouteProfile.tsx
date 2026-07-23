import styles from "./RouteProfile.module.css";

const VIEW_WIDTH = 300;
const VIEW_HEIGHT = 48;

type ElevationPoint = { distanceKm: number; altitudeM: number };

interface RouteProfileProps {
  points: ElevationPoint[];
}

export default function RouteProfile({ points }: RouteProfileProps) {
  if (points.length < 2) {
    return null;
  }

  const minAltitude = Math.min(...points.map((p) => p.altitudeM));
  const maxAltitude = Math.max(...points.map((p) => p.altitudeM));
  const maxDistance = points[points.length - 1].distanceKm || 1;
  const altitudeRange = maxAltitude - minAltitude || 1;

  const toX = (distanceKm: number) => (distanceKm / maxDistance) * VIEW_WIDTH;
  const toY = (altitudeM: number) => VIEW_HEIGHT - ((altitudeM - minAltitude) / altitudeRange) * VIEW_HEIGHT;

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${toX(p.distanceKm).toFixed(1)},${toY(p.altitudeM).toFixed(1)}`)
    .join(" ");

  const areaPath =
    `M${toX(points[0].distanceKm).toFixed(1)},${VIEW_HEIGHT} ` +
    points.map((p) => `L${toX(p.distanceKm).toFixed(1)},${toY(p.altitudeM).toFixed(1)}`).join(" ") +
    ` L${toX(points[points.length - 1].distanceKm).toFixed(1)},${VIEW_HEIGHT} Z`;

  const elevationGain = Math.round(
    points.reduce((gain, p, i) => {
      if (i === 0) return gain;
      const delta = p.altitudeM - points[i - 1].altitudeM;
      return delta > 0 ? gain + delta : gain;
    }, 0),
  );

  return (
    <div className={styles.wrap}>
      <svg
        className={styles.svg}
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path d={areaPath} className={styles.area} />
        <path d={linePath} className={styles.line} />
      </svg>
      <span className={styles.gain}>+{elevationGain} m</span>
    </div>
  );
}
