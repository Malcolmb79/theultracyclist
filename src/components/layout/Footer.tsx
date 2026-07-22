import { site } from "../../data/site";
import { fundraiser } from "../../data/fundraiser";
import ExternalLink from "../shared/ExternalLink";
import styles from "./Footer.module.css";

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={["container", styles.inner].join(" ")}>
        <span>
          &copy; {new Date().getFullYear()} {site.athleteName} &mdash; raising funds for{" "}
          {site.charityName}
        </span>
        <nav className={styles.links}>
          <ExternalLink href={site.instagramUrl}>Instagram</ExternalLink>
          <ExternalLink href={site.stravaUrl}>Strava</ExternalLink>
          <ExternalLink href={fundraiser.campaignUrl}>Donate</ExternalLink>
        </nav>
      </div>
    </footer>
  );
}
