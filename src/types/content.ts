export interface JourneyEntry {
  slug: string;
  title: string;
  date: string; // ISO "2026-08-01"
  excerpt: string;
  body: string[]; // paragraphs
  coverImage?: string;
}

export interface InstagramPost {
  url: string;
  caption?: string;
}

export interface RecordFacts {
  discipline: string;
  route: string;
  distanceKm: number;
  currentRecordHolder: string;
  currentRecordTime: string;
  /** When the standing record was set, e.g. "24 July 2023". */
  recordSetOn: string;
  /** The standing record's average speed, derived from its own distance and time. */
  recordAvgKmh: number;
  /** Who verified it. */
  sanctionedBy: string;
  rulesUrl: string;
}

export interface Donation {
  donorName: string;
  amount: number;
  currency: "ZAR" | "USD" | "EUR";
  date: string; // ISO
  message?: string;
}

export interface FundraiserInfo {
  campaignName: string;
  goalZAR: number;
  raisedZAR: number;
  lastUpdated: string; // ISO date
  campaignUrl: string;
}
