import { fundraiser } from "../../data/fundraiser";
import { formatZAR } from "../../utils/formatCurrency";
import { formatDate } from "../../utils/formatDate";
import Button from "../shared/Button";
import StatTile from "../shared/StatTile";
import styles from "./FundraiserProgress.module.css";

interface FundraiserProgressProps {
  compact?: boolean;
}

export default function FundraiserProgress({ compact = false }: FundraiserProgressProps) {
  const percent = Math.min(100, Math.round((fundraiser.raisedZAR / fundraiser.goalZAR) * 100));

  return (
    <div className={styles.wrap}>
      <div className={styles.track}>
        <div className={styles.fill} style={{ width: `${percent}%` }} />
      </div>
      <div className={styles.meta}>
        <span>{formatZAR(fundraiser.raisedZAR)} raised</span>
        <span>{percent}% of {formatZAR(fundraiser.goalZAR)} goal</span>
      </div>

      {!compact && (
        <div className={styles.stats}>
          <StatTile value={formatZAR(fundraiser.raisedZAR)} label="Raised so far" />
          <StatTile value={formatZAR(fundraiser.goalZAR)} label="Campaign goal" />
          <StatTile value={`${percent}%`} label="Funded" />
        </div>
      )}

      <Button href={fundraiser.campaignUrl} target="_blank" rel="noopener noreferrer">
        Donate on BackaBuddy
      </Button>
      <p className={styles.updated}>Last updated {formatDate(fundraiser.lastUpdated)}</p>
    </div>
  );
}
