/**
 * The record being attempted.
 *
 * These are not defaults. Every number the tracker page shows is derived from
 * them, so a wrong value here does not degrade the page - it makes it
 * confidently wrong, which is worse than showing nothing. Anything unset is
 * reported as unset and the dependent figures are suppressed rather than
 * guessed (see recordMaths.ts).
 *
 * Set through environment variables so the record can be corrected without a
 * code change, and so the ingest token never enters the repository.
 */

export type RecordConfig = {
  distanceM: number | null;
  recordSeconds: number | null;
  recordHolder: string | null;
  sanctioningBody: string;
  /**
   * Whether stopped time counts against the attempt.
   *
   * Confirmed for this attempt: it does, so the governing clock is the Edge's
   * elapsed time rather than its moving timer. This is the single setting that
   * can invalidate every figure on the page - if the sanctioning bodies ever
   * disagree, the stricter reading (elapsed) is the safe one, since a page
   * that under-claims cannot mislead anyone into thinking a record stands.
   */
  stoppedTimeCounts: boolean;
  riderName: string | null;
  attemptStartIso: string | null;
};

function envNumber(name: string): number | null {
  const raw = process.env[name];
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function envText(name: string): string | null {
  const raw = process.env[name]?.trim();
  return raw ? raw : null;
}

export function recordConfig(): RecordConfig {
  const km = envNumber("RECORD_DISTANCE_KM");
  return {
    distanceM: km == null ? null : km * 1000,
    recordSeconds: envNumber("RECORD_TIME_SECONDS"),
    recordHolder: envText("RECORD_HOLDER"),
    // Both bodies are sanctioning this attempt, so both are named.
    sanctioningBody: envText("SANCTIONING_BODY") ?? "WUCA & Guinness World Records",
    // Explicitly true rather than defaulted: the answer was confirmed, and a
    // silent default here is exactly the mistake the spec warns about.
    stoppedTimeCounts: (process.env.STOPPED_TIME_COUNTS ?? "true").toLowerCase() !== "false",
    riderName: envText("RIDER_NAME"),
    attemptStartIso: envText("ATTEMPT_START_ISO"),
  };
}

/** Whether the record maths can run at all - both D and T are required. */
export function recordIsConfigured(config: RecordConfig): boolean {
  return config.distanceM != null && config.recordSeconds != null;
}
