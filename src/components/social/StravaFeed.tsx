import { useEffect, useState } from "react";
import { strava } from "../../data/strava";
import { formatDate } from "../../utils/formatDate";
import ExternalLink from "../shared/ExternalLink";
import RideMap from "./RideMap";
import RouteProfile from "./RouteProfile";
import StravaSummary from "./StravaSummary";
import styles from "./StravaFeed.module.css";

type ElevationPoint = { distanceKm: number; altitudeM: number };

type PeriodSummary = {
  rideCount: number;
  distanceKm: number;
  movingTimeMinutes: number;
  elevationGainM: number;
  avgWatts: number | null;
  avgHeartrate: number | null;
  totalRelativeEffort: number | null;
};

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
  elevationProfile: ElevationPoint[];
};

type Athlete = {
  name: string;
  avatarUrl: string | null;
  profileUrl: string;
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

type Summary = { weekly: PeriodSummary; monthly: PeriodSummary };

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; athlete: Athlete | null; rides: Ride[]; summary: Summary | null };

export default function StravaFeed() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  // Empty until the saved-photos fetch lands, so the feed renders immediately
  // and photos appear when they arrive rather than holding up the rides.
  const [ridePhotos, setRidePhotos] = useState<Record<string, { photos: string[] }>>({});

  useEffect(() => {
    let cancelled = false;

    // Photos the athlete chose to publish, keyed by ride id. Unauthenticated
    // callers only ever receive rides marked public (see api/strava-photos.ts),
    // so this is safe to fetch from the public site.
    fetch("/api/strava-photos?action=saved")
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { rides?: Record<string, { photos: string[] }> } | null) => {
        if (body?.rides) setRidePhotos(body.rides);
      })
      .catch(() => {});

    fetch("/api/strava-activities")
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        return res.json() as Promise<{ athlete: Athlete | null; rides: Ride[]; summary: Summary | null }>;
      })
      .then((data) => {
        if (!cancelled) {
          setState({ status: "ready", athlete: data.athlete, rides: data.rides, summary: data.summary });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") {
    return (
      <div className={styles.wrap}>
        <p className={styles.placeholder}>Loading recent rides…</p>
      </div>
    );
  }

  if (state.status === "error" || state.rides.length === 0) {
    return (
      <div className={styles.wrap}>
        <p className={styles.placeholder}>
          Recent rides aren't available right now —{" "}
          <ExternalLink href={strava.profileUrl}>view the profile on Strava</ExternalLink> instead.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      {state.athlete && (
        <ExternalLink href={state.athlete.profileUrl} className={styles.athlete}>
          {state.athlete.avatarUrl && (
            <img src={state.athlete.avatarUrl} alt="" className={styles.avatar} />
          )}
          <span>{state.athlete.name} on Strava</span>
        </ExternalLink>
      )}
      {state.summary && <StravaSummary weekly={state.summary.weekly} monthly={state.summary.monthly} />}
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
                <RouteProfile points={ride.elevationProfile} distanceKm={ride.distanceKm} />
                {(ridePhotos[String(ride.id)]?.photos ?? []).length > 0 && (
                  <span className={styles.photoStrip}>
                    {ridePhotos[String(ride.id)].photos.map((src, i) => (
                      <img key={i} src={src} alt="" className={styles.photo} loading="lazy" />
                    ))}
                  </span>
                )}
              </div>
            </ExternalLink>
          </li>
        ))}
      </ul>
    </div>
  );
}
