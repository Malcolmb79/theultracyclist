// Standard Coggan Training Stress Score: work relative to threshold power,
// scaled so a maximal 1-hour effort right at FTP scores exactly 100. Needs
// weighted average power (Strava's Normalized-Power equivalent - the right
// input for TSS rather than plain average, since it accounts for how
// variable the effort was) and the athlete's own FTP - returns null rather
// than a misleading number if either is missing (no power meter on that
// ride, or FTP never set). Mirrors api/_lib/tss.ts - see that file's
// comment for why this is duplicated rather than shared across the
// frontend/api boundary.
export function computeTss(weightedAvgWatts: number | null, movingTimeMinutes: number, ftpWatts: number | null | undefined): number | null {
  if (weightedAvgWatts == null || weightedAvgWatts <= 0 || !ftpWatts || ftpWatts <= 0) return null;
  const intensityFactor = weightedAvgWatts / ftpWatts;
  const hours = movingTimeMinutes / 60;
  return Math.round(hours * intensityFactor * intensityFactor * 100 * 10) / 10;
}
