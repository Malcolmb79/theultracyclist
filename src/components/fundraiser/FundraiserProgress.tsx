import { fundraiser } from "../../data/fundraiser";
import { formatZAR, formatEUR } from "../../utils/formatCurrency";
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

  const raisedEur = rate ? formatEUR(fundraiser.raisedZAR * rate) : null;
  const goalEur = rate ? formatEUR(fundraiser.goalZAR * rate) : null;

  return (
    <div className={styles.wrap}>
      <div className={styles.track}>
        <div className={styles.fill} style={{ width: `${percent}%` }} />
      </div>
      <div className={styles.meta}>
        <span>
          {formatZAR(fundraiser.raisedZAR)} raised
          {raisedEur && ` (≈ ${raisedEur})`}
        </span>
        <span>
          {percent}% of {formatZAR(fundraiser.goalZAR)}
          {goalEur && ` (≈ ${goalEur})`} goal
        </span>
      </div>

      {!compact && (
        <div className={styles.stats}>
          <StatTile
            value={formatZAR(fundraiser.raisedZAR)}
            subValue={raisedEur && `≈ ${raisedEur}`}
            label="Raised so far"
          />
          <StatTile
            value={formatZAR(fundraiser.goalZAR)}
            subValue={goalEur && `≈ ${goalEur}`}
            label="Campaign goal"
          />
          <StatTile value={`${percent}%`} label="Funded" />
        </div>
      )}

      <Button href={fundraiser.campaignUrl} target="_blank" rel="noopener noreferrer">
        Donate on BackaBuddy
      </Button>
      <p className={styles.updated}>
        Last updated {formatDate(fundraiser.lastUpdated)} · EUR conversion updates live
      </p>
    </div>
  );
}
