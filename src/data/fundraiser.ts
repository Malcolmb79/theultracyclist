import type { FundraiserInfo } from "../types/content";

// Update raisedZAR and lastUpdated whenever the BackaBuddy total changes.
// The percentage shown on the site is always computed from goalZAR/raisedZAR,
// so there is only ever one number to edit here.
export const fundraiser: FundraiserInfo = {
  campaignName: "The Maboneng Foundation",
  goalZAR: 200_000,
  raisedZAR: 24_681,
  lastUpdated: "2026-07-22",
  campaignUrl:
    "https://www.backabuddy.co.za/campaign/the-maboneng-foundation-5733579859024175500",
};
