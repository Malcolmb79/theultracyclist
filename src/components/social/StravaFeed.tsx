import { useEffect, useState } from "react";
import { strava } from "../../data/strava";
import { formatDate } from "../../utils/formatDate";
import ExternalLink from "../shared/ExternalLink";
import RideMap from "./RideMap";
import styles from "./StravaFeed.module.css";

type Ride = {
  id: number;
  name: string;
  distanceKm: number;
  movingTimeMinutes: number;
  startDate: string;
  url: string;
  polyline: string;
  avgWatts: number | null;
  weightedAvgWatts: number | null;
  avgHeartrate: number | null;
  maxHeartrate: number | null;
  relativeEffort: number | null;
};

function performanceStats(ride: Ride): string[] {
  const stats: string[] = [];
  if (ride.avgWatts) stats.push(`${ride.avgWatts} W avg`);
  if (ride.weightedAvgWatts) stats.push(`${ride.weightedAvgWatts} W norm`);
  if (ride.avgHeartrate) stats.push(`${ride.avgHeartrate} bpm avg`);
  if (ride.maxHeartrate) stats.push(`${ride.maxHeartrate} bpm max`);
  if (ride.relativeEffort) stats.push(`${ride.relativeEffort} effort`);
  return stats;
}

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; rides: Ride[] };

export default function StravaFeed() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    fetch("/api/strava-activities")
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        return res.json() as Promise<{ rides: Ride[] }>;
      })
      .then((data) => {
        if (!cancelled) setState({ status: "ready", rides: data.rides });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") {
    return <p className={styles.placeholder}>Loading recent rides…</p>;
  }

  if (state.status === "error" || state.rides.length === 0) {
    return (
      <p className={styles.placeholder}>
        Recent rides aren't available right now —{" "}
        <ExternalLink href={strava.profileUrl}>view the profile on Strava</ExternalLink> instead.
      </p>
    );
  }

  return (
    <ul className={styles.list}>
      {state.rides.map((ride) => (
        <li key={ride.id} className={styles.item}>
          <ExternalLink href={ride.url} className={styles.link}>
            <div className={styles.thumb}>
              <RideMap polyline={ride.polyline} />
            </div>
            <div className={styles.details}>
              <span className={styles.name}>{ride.name}</span>
              <span className={styles.meta}>
                {formatDate(ride.startDate)} · {ride.distanceKm} km · {ride.movingTimeMinutes} min
              </span>
              {performanceStats(ride).length > 0 && (
                <span className={styles.stats}>{performanceStats(ride).join(" · ")}</span>
              )}
            </div>
          </ExternalLink>
        </li>
      ))}
    </ul>
  );
}
