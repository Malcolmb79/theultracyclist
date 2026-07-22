import { fundraiser } from "../../data/fundraiser";
import { donations } from "../../data/donations";
import { formatEUR } from "../../utils/formatCurrency";
import { formatDate } from "../../utils/formatDate";
import { useEurRates, convertToEur } from "../../hooks/useEurRates";
import Button from "../shared/Button";
import StatTile from "../shared/StatTile";
import RecentDonations from "./RecentDonations";
import styles from "./FundraiserProgress.module.css";

interface FundraiserProgressProps {
  compact?: boolean;
}

export default function FundraiserProgress({ compact = false }: FundraiserProgressProps) {
  const percent = Math.min(100, Math.round((fundraiser.raisedZAR / fundraiser.goalZAR) * 100));
  const { rates } = useEurRates();

  const raisedEur = convertToEur(fundraiser.raisedZAR, "ZAR", rates);
  const goalEur = convertToEur(fundraiser.goalZAR, "ZAR", rates);
  const raisedDisplay = raisedEur !== null ? formatEUR(raisedEur) : "…";
  const goalDisplay = goalEur !== null ? formatEUR(goalEur) : "…";

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

      {!compact && <RecentDonations donations={donations} />}

      <Button href={fundraiser.campaignUrl} target="_blank" rel="noopener noreferrer">
        Donate on BackaBuddy
      </Button>
      <p className={styles.updated}>Last updated {formatDate(fundraiser.lastUpdated)}</p>
    </div>
  );
}
