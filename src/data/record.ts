import type { RecordFacts } from "../types/content";

/**
 * The standing record this attempt is chasing.
 *
 * Figures supplied by the athlete from the WUCA ledger. They are internally
 * consistent, which is worth noting because it means a typo in any one of them
 * would show: 567.6 km in 19h30m is 29.11 km/h, and 352.7 miles in the same
 * time is 18.09 mph.
 *
 * The live tracker does NOT read this file - it computes ahead/behind from
 * RECORD_DISTANCE_KM and RECORD_TIME_SECONDS in the Vercel environment (see
 * api/_lib/recordConfig.ts). Both have to be right, and they have to agree.
 */
export const record: RecordFacts = {
  discipline: "Solo and unsupported, Ireland north to south",
  route: "Malin Head to Mizen Head (traditional Irish end-to-end route)",
  distanceKm: 567.6,
  currentRecordHolder: "Mervyn Kinkade (Ireland)",
  currentRecordTime: "19h 30m",
  recordSetOn: "24 July 2023",
  // 567.6 km / 19.5 h. Stored rather than computed so the page never derives a
  // speed from a distance the record holder didn't actually ride.
  recordAvgKmh: 29.1,
  sanctionedBy: "World Ultracycling Association (WUCA)",
  rulesUrl: "https://ultracycling.com/cross-country-records/",
};
