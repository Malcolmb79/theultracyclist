import { Link } from "react-router-dom";
import type { JourneyEntry } from "../../types/content";
import { formatDate } from "../../utils/formatDate";
import styles from "./JourneyCard.module.css";

interface JourneyCardProps {
  entry: JourneyEntry;
}

export default function JourneyCard({ entry }: JourneyCardProps) {
  return (
    <Link to={`/journey/${entry.slug}`} className={styles.card}>
      {entry.coverImage && <img className={styles.cover} src={entry.coverImage} alt="" />}
      <div className={styles.body}>
        <span className={styles.date}>{formatDate(entry.date)}</span>
        <h3 className={styles.title}>{entry.title}</h3>
        <p className={styles.excerpt}>{entry.excerpt}</p>
      </div>
    </Link>
  );
}
