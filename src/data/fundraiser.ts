import type { FundraiserInfo } from "../types/content";

// Update raisedZAR and lastUpdated whenever the BackaBuddy total changes
// (the daily scheduled sync task does this automatically). The percentage
// shown on the site is always computed from goalZAR/raisedZAR, so there is
// only ever one number to edit for that. See data/donations.ts for the
// individual donations list.
export const fundraiser: FundraiserInfo = {
  campaignName: "The Maboneng Foundation",
  goalZAR: 200_000,
  raisedZAR: 24_681,
  lastUpdated: "2026-07-22",
  campaignUrl:
    "https://www.backabuddy.co.za/campaign/the-maboneng-foundation-5733579859024175500",
};
