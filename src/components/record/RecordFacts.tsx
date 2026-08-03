import { record } from "../../data/record";
import ExternalLink from "../shared/ExternalLink";
import StatTile from "../shared/StatTile";
import styles from "./RecordFacts.module.css";

export default function RecordFacts() {
  return (
    <div>
      <div className={styles.grid}>
        <StatTile value={`${record.distanceKm} km`} label="Distance" />
        <StatTile
          value={record.currentRecordTime}
          subValue={`${record.recordAvgKmh} km/h average`}
          label="Record to beat"
        />
        <StatTile value={record.currentRecordHolder} subValue={`Set ${record.recordSetOn}`} label="Current holder" />
      </div>
      <p>
        <strong>Route:</strong> {record.route}
      </p>
      <p>
        <strong>Discipline:</strong> {record.discipline}
      </p>
      <p>
        <strong>Verified by:</strong> {record.sanctionedBy}
      </p>
      <p className={styles.note}>
        Rules and the official ledger are maintained by the World UltraCycling
        Association — <ExternalLink href={record.rulesUrl}>view the records list</ExternalLink>.
      </p>
    </div>
  );
}
