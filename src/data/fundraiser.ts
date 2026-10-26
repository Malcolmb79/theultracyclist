import type { FundraiserInfo } from "../types/content";

// Update raisedZAR and lastUpdated whenever the BackaBuddy total changes
// (the daily scheduled sync task does this automatically). goalZAR is the
// BackaBuddy campaign's own goal; goalEUR is the goal the site shows, a round
// euro figure, and the percentage is the euro total raised against it. See data/donations.ts for the
// individual donations list.
export const fundraiser: FundraiserInfo = {
  campaignName: "The Maboneng Foundation",
  goalZAR: 200_000,
  goalEUR: 10_000,
  raisedZAR: 24_681,
  lastUpdated: "2026-07-22",
  campaignUrl:
    "https://www.backabuddy.co.za/campaign/the-maboneng-foundation-5733579859024175500",
};
