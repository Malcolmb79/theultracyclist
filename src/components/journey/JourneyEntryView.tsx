import type { JourneyEntry } from "../../types/content";
import { formatDate } from "../../utils/formatDate";
import styles from "./JourneyEntryView.module.css";

interface JourneyEntryViewProps {
  entry: JourneyEntry;
}

export default function JourneyEntryView({ entry }: JourneyEntryViewProps) {
  return (
    <article>
      <span className={styles.date}>{formatDate(entry.date)}</span>
      <h1 className={styles.title}>{entry.title}</h1>
      {entry.coverImage && <img className={styles.cover} src={entry.coverImage} alt="" />}
      <div className={styles.body}>
        {entry.body.map((paragraph, i) => (
          <p key={i}>{paragraph}</p>
        ))}
      </div>
    </article>
  );
}
