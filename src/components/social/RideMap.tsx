import { decodePolyline } from "../../utils/decodePolyline";
import styles from "./RideMap.module.css";

const VIEW_SIZE = 64;
const PADDING = 6;

interface RideMapProps {
  polyline: string;
}

export default function RideMap({ polyline }: RideMapProps) {
  const points = polyline ? decodePolyline(polyline) : [];

  if (points.length < 2) {
    return <div className={styles.placeholder} aria-hidden="true" />;
  }

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const [lat, lng] of points) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }

  const latRange = maxLat - minLat || 1;
  const lngRange = maxLng - minLng || 1;
  const drawable = VIEW_SIZE - PADDING * 2;
  const scale = drawable / Math.max(latRange, lngRange);
  const offsetX = (VIEW_SIZE - lngRange * scale) / 2;
  const offsetY = (VIEW_SIZE - latRange * scale) / 2;

  const path = points
    .map(([lat, lng], i) => {
      const x = (lng - minLng) * scale + offsetX;
      const y = VIEW_SIZE - ((lat - minLat) * scale + offsetY);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      className={styles.svg}
      viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d={path} className={styles.route} />
    </svg>
  );
}
