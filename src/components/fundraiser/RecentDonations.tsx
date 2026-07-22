import { useState } from "react";
import type { Donation } from "../../types/content";
import { useEurRates, convertToEur } from "../../hooks/useEurRates";
import { formatEUR } from "../../utils/formatCurrency";
import { formatDate } from "../../utils/formatDate";
import styles from "./RecentDonations.module.css";

interface RecentDonationsProps {
  donations: Donation[];
  previewCount?: number;
}

export default function RecentDonations({ donations, previewCount = 4 }: RecentDonationsProps) {
  const [expanded, setExpanded] = useState(false);
  const { rates } = useEurRates();

  if (donations.length === 0) return null;

  const shown = expanded ? donations : donations.slice(0, previewCount);
  const remaining = donations.length - previewCount;

  return (
    <div className={styles.wrap}>
      <div className={styles.heading}>Recent donations</div>
      <div className={styles.list}>
        {shown.map((donation, i) => {
          const eur = convertToEur(donation.amount, donation.currency, rates);
          return (
            <div className={styles.row} key={`${donation.donorName}-${donation.date}-${i}`}>
              <span className={styles.amount}>{eur !== null ? formatEUR(eur) : "…"}</span>
              <span className={styles.donor}>{donation.donorName}</span>
              <span className={styles.date}>{formatDate(donation.date)}</span>
              {donation.message && <p className={styles.message}>&ldquo;{donation.message}&rdquo;</p>}
            </div>
          );
        })}
      </div>

      {!expanded && remaining > 0 && (
        <button type="button" className={styles.toggle} onClick={() => setExpanded(true)}>
          View all {donations.length} donors &rarr;
        </button>
      )}
      {expanded && (
        <button type="button" className={styles.toggle} onClick={() => setExpanded(false)}>
          Show less
        </button>
      )}
    </div>
  );
}
