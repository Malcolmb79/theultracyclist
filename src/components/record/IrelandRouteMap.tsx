import styles from "./IrelandRouteMap.module.css";

// Outline geometrically simplified (Douglas-Peucker, ~63 points) from the
// island-of-Ireland outline in "Blank Ireland.svg" by Angr / Nae'blis,
// Wikimedia Commons, CC BY-SA 3.0: https://commons.wikimedia.org/wiki/File:Blank_Ireland.svg
export const ISLAND_PATH =
  "M28.1,343.4 L44.5,323.6 L13,331.9 L38.9,312.9 L14.4,321.1 L2.9,312.8 L31.2,294.5 L0.5,289.4 " +
  "L32.5,285.5 L24.5,273.3 L38.2,261.4 L76.9,255.5 L68.2,246.9 L52.1,260.1 L25.1,261.8 L42.9,249.3 " +
  "L55,219.6 L71.1,214.6 L16.4,198.5 L27.9,174.4 L43.4,171.8 L27.4,166.1 L31.4,147.8 L23.8,139.6 " +
  "L20.4,149.1 L20.7,138.7 L34.2,131.7 L54.6,134.1 L61.9,146.7 L65.8,135.9 L87.6,141.6 L83.1,130.5 " +
  "L106.3,112.3 L76.7,106.1 L93.4,101.5 L91.9,83.8 L111.1,67.7 L123.1,76.5 L125.9,63.3 L125.2,86.1 " +
  "L138.6,56.6 L155.1,66 L141.6,79.8 L189.6,67 L208.6,97.4 L200.9,112.1 L212.2,105.5 L220,120.5 " +
  "L217.9,129.9 L208.5,114.4 L215.2,134.2 L180.9,155.4 L199.1,231.8 L184.5,289.4 L166.2,284 " +
  "L159.3,294 L156.2,282.9 L156.4,291.7 L128.8,296.6 L109.6,316.9 L93.4,311.9 L86.3,332.2 L28.1,343.4 Z";

const MALIN_HEAD = { x: 138.6, y: 56.6 };
const MIZEN_HEAD = { x: 28.1, y: 343.4 };

export default function IrelandRouteMap() {
  return (
    <div className={styles.wrap}>
      <svg className={styles.svg} viewBox="-20 -10 260 420" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="routeGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" />
            <stop offset="100%" stopColor="var(--color-accent-2)" />
          </linearGradient>
        </defs>

        <path className={styles.island} d={ISLAND_PATH} />

        <path
          className={styles.route}
          d={`M${MALIN_HEAD.x},${MALIN_HEAD.y} Q110,190 ${MIZEN_HEAD.x},${MIZEN_HEAD.y}`}
        />

        <circle cx={MALIN_HEAD.x} cy={MALIN_HEAD.y} r="5" fill="var(--color-accent)" />
        <text x={MALIN_HEAD.x + 10} y={MALIN_HEAD.y + 4} className={[styles.label, styles.labelStart].join(" ")}>
          Malin Head
        </text>

        <circle cx={MIZEN_HEAD.x} cy={MIZEN_HEAD.y} r="5" fill="var(--color-accent-2)" />
        <text
          x={MIZEN_HEAD.x - 10}
          y={MIZEN_HEAD.y + 18}
          textAnchor="end"
          className={[styles.label, styles.labelEnd].join(" ")}
        >
          Mizen Head
        </text>
      </svg>
    </div>
  );
}
