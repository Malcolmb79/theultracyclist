import { record } from "../../data/record";
import ExternalLink from "../shared/ExternalLink";
import StatTile from "../shared/StatTile";
import styles from "./RecordFacts.module.css";

export default function RecordFacts() {
  return (
    <div>
      <div className={styles.grid}>
        <StatTile value={record.distanceMiles} label="Miles" />
        <StatTile value={record.currentRecordTime} label="Record to beat" />
        <StatTile value={record.currentRecordHolder} label="Current holder" />
      </div>
      <p>
        <strong>Route:</strong> {record.route}
      </p>
      <p>
        <strong>Discipline:</strong> {record.discipline}
      </p>
      <p className={styles.note}>
        Rules and the official ledger are maintained by the World UltraCycling
        Association — <ExternalLink href={record.rulesUrl}>view the records list</ExternalLink>.
      </p>
    </div>
  );
}
