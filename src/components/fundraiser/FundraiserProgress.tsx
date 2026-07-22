import { fundraiser } from "../../data/fundraiser";
import { formatEUR } from "../../utils/formatCurrency";
import { formatDate } from "../../utils/formatDate";
import { useZarToEurRate } from "../../hooks/useZarToEurRate";
import Button from "../shared/Button";
import StatTile from "../shared/StatTile";
import styles from "./FundraiserProgress.module.css";

interface FundraiserProgressProps {
  compact?: boolean;
}

export default function FundraiserProgress({ compact = false }: FundraiserProgressProps) {
  const percent = Math.min(100, Math.round((fundraiser.raisedZAR / fundraiser.goalZAR) * 100));
  const { rate } = useZarToEurRate();

  const raisedDisplay = rate ? formatEUR(fundraiser.raisedZAR * rate) : "…";
  const goalDisplay = rate ? formatEUR(fundraiser.goalZAR * rate) : "…";

  return (
    <div className={styles.wrap}>
      <div className={styles.track}>
        <div className={styles.fill} style={{ width: `${percent}%` }} />
      </div>
      <div className={styles.meta}>
        <span>{raisedDisplay} raised</span>
        <span>
          {percent}% of {goalDisplay} goal
        </span>
      </div>

      {!compact && (
        <div className={styles.stats}>
          <StatTile value={raisedDisplay} label="Raised so far" />
          <StatTile value={goalDisplay} label="Campaign goal" />
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
