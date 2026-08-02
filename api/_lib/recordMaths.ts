/**
 * Every derived figure the tracker shows. Computed here and nowhere else - the
 * page performs no record arithmetic.
 *
 * Pure on purpose: the edge cases in this file are the ones that make a record
 * page embarrassing (an infinity in the hero, a projection that swings on every
 * descent, a required average that goes negative after the record time passes),
 * and they are far easier to prove correct against fixtures than against a live
 * ride.
 */

export type RecordInputs = {
  /** The record distance, metres. */
  distanceM: number;
  /** The standing record, seconds. */
  recordSeconds: number;
  /** Distance covered, metres, taken from the Edge - never recomputed from GPS. */
  coveredM: number;
  /** The governing clock, seconds: elapsed when stopped time counts, else the timer. */
  governingS: number;
  /** delta_s one hour ago, for the trend. Null until an hour of ride exists. */
  deltaOneHourAgoS: number | null;
};

export type RecordOutput = {
  deltaS: number | null;
  deltaTrendSPerHr: number | null;
  requiredAvgMps: number | null;
  projectedFinishS: number | null;
  projectedDeltaS: number | null;
  recordAvgMps: number;
  avgSpeedElapsedMps: number | null;
  /** True once the record distance is complete - every figure freezes. */
  finished: boolean;
  /** True when the record time has passed with the distance incomplete. */
  recordTimePassed: boolean;
};

/**
 * Below these the derived rates are meaningless and wildly unstable - a
 * required average computed twelve seconds into a 570km ride says nothing, and
 * a projection from forty metres of GPS noise says less. The page shows the
 * clock and the distance until both are cleared.
 */
const MIN_SECONDS_FOR_RATES = 60;
const MIN_METRES_FOR_RATES = 200;

export function computeRecord(input: RecordInputs): RecordOutput {
  const { distanceM: D, recordSeconds: T, coveredM: d, governingS: t } = input;
  const recordAvgMps = D / T;

  const finished = d >= D;
  const recordTimePassed = t >= T && !finished;
  const ratesReady = t >= MIN_SECONDS_FOR_RATES && d >= MIN_METRES_FOR_RATES;

  // How long the record holder would have taken to reach this distance, minus
  // how long it has actually taken. Positive means ahead.
  const deltaS = ratesReady || finished ? Math.round(d / recordAvgMps - t) : null;

  const avgSpeedElapsedMps = ratesReady && t > 0 ? d / t : null;

  // Once the distance is done, everything freezes at its finishing value: a
  // required average or a projection past the finish line is noise.
  if (finished) {
    return {
      deltaS,
      deltaTrendSPerHr: trend(deltaS, input.deltaOneHourAgoS),
      requiredAvgMps: null,
      projectedFinishS: Math.round(t),
      projectedDeltaS: Math.round(T - t),
      recordAvgMps,
      avgSpeedElapsedMps,
      finished: true,
      recordTimePassed: false,
    };
  }

  // The record time has run out with distance still to cover. There is no
  // "required average" that gets there any more, and rendering (D - d) / 0 or
  // a negative rate would put an infinity or a nonsense in the hero.
  if (recordTimePassed) {
    return {
      deltaS,
      deltaTrendSPerHr: trend(deltaS, input.deltaOneHourAgoS),
      requiredAvgMps: null,
      projectedFinishS: projectFinish(t, D, d, avgSpeedElapsedMps),
      projectedDeltaS: null,
      recordAvgMps,
      avgSpeedElapsedMps,
      finished: false,
      recordTimePassed: true,
    };
  }

  const requiredAvgMps = ratesReady ? (D - d) / (T - t) : null;
  const projectedFinishS = projectFinish(t, D, d, avgSpeedElapsedMps);

  return {
    deltaS,
    deltaTrendSPerHr: trend(deltaS, input.deltaOneHourAgoS),
    requiredAvgMps: requiredAvgMps == null ? null : round2(requiredAvgMps),
    projectedFinishS,
    projectedDeltaS: projectedFinishS == null ? null : Math.round(T - projectedFinishS),
    recordAvgMps: round2(recordAvgMps),
    avgSpeedElapsedMps: avgSpeedElapsedMps == null ? null : round2(avgSpeedElapsedMps),
    finished: false,
    recordTimePassed: false,
  };
}

/**
 * Projected finish, from overall average speed rather than current or moving
 * speed. Current speed makes the headline number lurch on every descent and
 * every traffic light, which reads as a broken page rather than as a fast
 * descent.
 */
function projectFinish(t: number, D: number, d: number, avgMps: number | null): number | null {
  if (avgMps == null || avgMps <= 0) return null;
  return Math.round(t + (D - d) / avgMps);
}

function trend(deltaS: number | null, deltaOneHourAgoS: number | null): number | null {
  if (deltaS == null || deltaOneHourAgoS == null) return null;
  return Math.round(deltaS - deltaOneHourAgoS);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
