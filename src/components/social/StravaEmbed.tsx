import { strava } from "../../data/strava";
import ExternalLink from "../shared/ExternalLink";
import styles from "./StravaEmbed.module.css";

export default function StravaEmbed() {
  if (!strava.widgetSrc) {
    return (
      <div className={styles.wrap}>
        <p className={styles.placeholder}>
          Strava activity widget not configured yet —{" "}
          <ExternalLink href={strava.profileUrl}>view the profile on Strava</ExternalLink> for
          now.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <iframe
        src={strava.widgetSrc}
        height={454}
        title="Latest Strava activities"
        loading="lazy"
      />
    </div>
  );
}
