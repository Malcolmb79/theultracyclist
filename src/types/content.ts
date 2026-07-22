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
  distanceMiles: number;
  currentRecordHolder: string;
  currentRecordTime: string;
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
