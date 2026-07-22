import type { JourneyEntry } from "../../types/content";
import JourneyCard from "./JourneyCard";
import styles from "./JourneyList.module.css";

interface JourneyListProps {
  entries: JourneyEntry[];
  limit?: number;
}

export default function JourneyList({ entries, limit }: JourneyListProps) {
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? 1 : -1));
  const shown = limit ? sorted.slice(0, limit) : sorted;

  return (
    <div className={styles.grid}>
      {shown.map((entry) => (
        <JourneyCard key={entry.slug} entry={entry} />
      ))}
    </div>
  );
}
