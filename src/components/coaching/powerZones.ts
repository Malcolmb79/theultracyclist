import type { PowerZone } from "./types";

// Standard 7-zone (Coggan) model as a percentage of FTP. Bands are
// deliberately simple/well-established rather than a custom scheme, since
// most cyclists already have some familiarity with this exact breakdown.
const ZONE_DEFINITIONS: { name: string; key: PowerZone["key"]; minPercent: number; maxPercent: number | null }[] = [
  { name: "Active Recovery", key: "recovery", minPercent: 0, maxPercent: 55 },
  { name: "Endurance", key: "endurance", minPercent: 55, maxPercent: 75 },
  { name: "Tempo", key: "tempo", minPercent: 75, maxPercent: 90 },
  { name: "Threshold", key: "threshold", minPercent: 90, maxPercent: 105 },
  { name: "VO2 Max", key: "vo2max", minPercent: 105, maxPercent: 120 },
  { name: "Anaerobic", key: "anaerobic", minPercent: 120, maxPercent: 150 },
  { name: "Neuromuscular", key: "neuromuscular", minPercent: 150, maxPercent: null },
];

export function computePowerZones(ftpWatts: number | null): PowerZone[] {
  return ZONE_DEFINITIONS.map((z) => ({
    ...z,
    minWatts: ftpWatts != null ? Math.round((z.minPercent / 100) * ftpWatts) : null,
    maxWatts: ftpWatts != null && z.maxPercent != null ? Math.round((z.maxPercent / 100) * ftpWatts) : null,
  }));
}

export function classifyPower(avgWatts: number, ftpWatts: number | null): PowerZone | null {
  if (ftpWatts == null || ftpWatts <= 0) return null;
  const percent = (avgWatts / ftpWatts) * 100;
  const zones = computePowerZones(ftpWatts);
  return zones.find((z) => percent >= z.minPercent && (z.maxPercent == null || percent < z.maxPercent)) ?? null;
}
