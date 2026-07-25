// HRV has no universal "good" absolute value - it's highly individual, so
// unlike recovery score (already 0-100 and banded by Whoop itself), HRV
// readiness is judged by how today's reading compares to the athlete's own
// recent baseline. Bands below match the deviation-from-baseline approach
// used by Oura/WHOOP's own trend views and EliteHRV, not a fixed ms cutoff.
const AMBER_THRESHOLD_PERCENT = -5;
const RED_THRESHOLD_PERCENT = -15;
const BASELINE_WINDOW_DAYS = 7;

export function hrvReadinessColor(chronologicalValues: number[]): string {
  if (chronologicalValues.length < 2) return "var(--color-accent-2)";

  const latest = chronologicalValues[chronologicalValues.length - 1];
  const baselineValues = chronologicalValues.slice(0, -1).slice(-BASELINE_WINDOW_DAYS);
  const baseline = baselineValues.reduce((sum, v) => sum + v, 0) / baselineValues.length;
  if (!baseline) return "var(--color-accent-2)";

  const percentChange = ((latest - baseline) / baseline) * 100;
  if (percentChange <= RED_THRESHOLD_PERCENT) return "var(--color-accent)";
  if (percentChange <= AMBER_THRESHOLD_PERCENT) return "var(--color-amber)";
  return "var(--color-accent-2)";
}
