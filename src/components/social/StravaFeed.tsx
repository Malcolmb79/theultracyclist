import { useEffect, useState } from "react";
import { strava } from "../../data/strava";
import { formatDate } from "../../utils/formatDate";
import ExternalLink from "../shared/ExternalLink";
import styles from "./StravaFeed.module.css";

type Ride = {
  id: number;
  name: string;
  distanceKm: number;
  movingTimeMinutes: number;
  startDate: string;
  url: string;
};

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
            <span className={styles.name}>{ride.name}</span>
            <span className={styles.meta}>
              {formatDate(ride.startDate)} · {ride.distanceKm} km · {ride.movingTimeMinutes} min
            </span>
          </ExternalLink>
        </li>
      ))}
    </ul>
  );
}
