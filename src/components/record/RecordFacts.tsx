import { record } from "../../data/record";
import ExternalLink from "../shared/ExternalLink";
import StatTile from "../shared/StatTile";
import styles from "./RecordFacts.module.css";

export default function RecordFacts() {
  return (
    <div>
      <div className={styles.grid}>
        <StatTile value={`${record.distanceKm} km`} label="Distance" />
        <StatTile value={record.currentRecordTime} label="Record to beat" />
        {/* The third tile is the pace that time implies rather than the name
            of the rider who set it - it's the number that actually governs a
            ride, and it keeps the grid at three across. */}
        <StatTile value={`${record.recordAvgKmh} km/h`} label="Average to beat" />
      </div>
      <p>
        <strong>Route:</strong> {record.route}
      </p>
      <p>
        <strong>Discipline:</strong> {record.discipline}
      </p>
      <p>
        <strong>Standing record:</strong> set {record.recordSetOn}, verified by {record.sanctionedBy}
      </p>
      <p className={styles.note}>
        The World Ultracycling Association keeps the rules and the official ledger.{" "}
        <ExternalLink href={record.rulesUrl}>View the records list</ExternalLink>.
      </p>
    </div>
  );
}
