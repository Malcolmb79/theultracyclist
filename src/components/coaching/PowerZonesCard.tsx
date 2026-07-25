import { Link } from "react-router-dom";
import type { CoachingSettings, RideZoneClassification } from "./types";
import { computePowerZones } from "./powerZones";
import { formatDate } from "../../utils/formatDate";
import styles from "./PowerZonesCard.module.css";

interface PowerZonesCardProps {
  settings: CoachingSettings;
  recentRides: RideZoneClassification[];
}

export default function PowerZonesCard({ settings, recentRides }: PowerZonesCardProps) {
  const ftp = settings.ftpWatts ?? null;
  const zones = computePowerZones(ftp);

  return (
    <div className={styles.card}>
      <span className={styles.eyebrow}>Power zones</span>

      {ftp == null ? (
        <p className={styles.empty}>
          Set your FTP in <Link to="/dashboard/settings">Settings</Link> to see your zones and have recent rides
          classified against them. There's no way to auto-detect FTP from the data available here (that needs
          second-by-second power data, which isn't part of Strava's summary API) - enter your own best estimate.
        </p>
      ) : (
        <>
          <ul className={styles.zoneList}>
            {zones.map((z) => (
              <li key={z.key} className={styles.zoneRow}>
                <span className={styles.zoneName}>{z.name}</span>
                <span className={styles.zoneRange}>
                  {z.minWatts}
                  {z.maxWatts != null ? `–${z.maxWatts}` : "+"} W
                </span>
              </li>
            ))}
          </ul>

          {recentRides.length > 0 && (
            <div className={styles.rides}>
              <span className={styles.subheading}>Recent rides by average power</span>
              <p className={styles.note}>
                This is each ride's average power against your zones, not time-in-zone - Strava's summary data
                doesn't include a second-by-second power stream to calculate that precisely.
              </p>
              <ul className={styles.rideList}>
                {recentRides
                  .filter((r) => r.avgWatts > 0)
                  .map((r) => (
                    <li key={r.rideId} className={styles.rideRow}>
                      <span className={styles.rideName}>{r.name}</span>
                      <span className={styles.rideDate}>{formatDate(r.date)}</span>
                      <span className={styles.rideZone}>{r.zone ? `${r.zone.name} (${r.avgWatts}W)` : `${r.avgWatts}W`}</span>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
