import { site } from "../../data/site";
import Button from "../shared/Button";
import styles from "./FollowLinks.module.css";

export default function FollowLinks() {
  return (
    <div className={styles.row}>
      <Button href={site.instagramUrl} target="_blank" rel="noopener noreferrer">
        Follow on Instagram
      </Button>
      <Button variant="secondary" href={site.stravaUrl} target="_blank" rel="noopener noreferrer">
        Follow on Strava
      </Button>
    </div>
  );
}
