import { useState } from "react";
import { athleteName, type SauceAthleteData } from "../components/race/sauceFeed";
import styles from "./Avatar.module.css";

/** A rider's Zwift picture, or their initial if there's none or it won't load. */
export function Avatar({ r }: { r: SauceAthleteData }) {
  const [failed, setFailed] = useState(false);
  const src = (r.athlete as { avatar?: string } | undefined)?.avatar;
  if (!src || failed) return <span className={`${styles.avatar} ${styles.initial}`}>{athleteName(r).slice(0, 1)}</span>;
  return <img className={styles.avatar} src={src} alt="" onError={() => setFailed(true)} />;
}
