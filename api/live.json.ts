import type { VercelRequest, VercelResponse } from "@vercel/node";
import { EDGE_STALE_S, latestPerDevice, latestWithDistance, mergePosition, sampleNearTimestamp, samplesSince } from "./_lib/trackerDb.js";
import { computeRecord } from "./_lib/recordMaths.js";
import { recordConfig, recordIsConfigured } from "./_lib/recordConfig.js";

/**
 * Everything the tracker page renders, computed here.
 *
 * The page performs no record arithmetic: a thousand phones each deriving a
 * projection from a raw sample list is a thousand chances to disagree with one
 * another, and the one number everybody screenshots has to be the same number
 * on every screen.
 *
 * Cached at the edge for 10 seconds. That is what makes a crowd of
 * dot-watchers cost one database read per ten seconds rather than one per
 * viewer per poll.
 */

// No feed at all for this long and the whole page is stale.
const FEED_STALE_S = 300;
// Rolling windows for the live tiles.
const POWER_WINDOW_S = 30;
const HR_WINDOW_S = 300;
const NP_WINDOW_S = 1800;

type Nullable = number | null;

function avg(values: number[]): Nullable {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

function round(value: Nullable, dp = 2): Nullable {
  if (value == null) return null;
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

/**
 * Normalised power: the fourth root of the mean of the fourth powers of a
 * 30-second rolling average. Rewards steady riding and punishes surges, which
 * over an ultra is a far better description of cost than a plain average.
 *
 * Needs a real window to mean anything, so it returns null rather than a
 * flattering number computed from ninety seconds of data.
 */
function normalisedPower(powers: { ts: number; w: number }[]): Nullable {
  if (powers.length < 30) return null;
  const rolling: number[] = [];
  for (let i = 0; i < powers.length; i++) {
    const from = powers[i].ts - POWER_WINDOW_S;
    const window = powers.filter((p) => p.ts <= powers[i].ts && p.ts >= from).map((p) => p.w);
    if (window.length > 0) rolling.push(window.reduce((a, b) => a + b, 0) / window.length);
  }
  if (rolling.length === 0) return null;
  const mean4 = rolling.reduce((sum, w) => sum + w ** 4, 0) / rolling.length;
  return mean4 ** 0.25;
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const config = recordConfig();
  const nowTs = Math.floor(Date.now() / 1000);

  try {
    const [devices, withDistance] = await Promise.all([latestPerDevice(), latestWithDistance()]);
    const edge = devices.edge1040 ?? null;
    const traccar = devices.traccar ?? null;

    const edgeAge = edge ? nowTs - edge.ts : Infinity;
    const traccarAge = traccar ? nowTs - traccar.ts : Infinity;
    const edgeStale = edgeAge > EDGE_STALE_S;

    // One source per segment, never interleaved: whichever is chosen supplies
    // the position, and the page is told which so it can say so (see
    // mergePosition in trackerDb.ts for the fallback order, shared with
    // api/live-tracker.ts so the two never disagree about what's stale).
    const positionFrom = mergePosition(edge, traccar, nowTs);
    const positionSource = positionFrom == null ? null : positionFrom === traccar ? "traccar" : "edge";

    const newestTs = Math.max(edge?.ts ?? 0, traccar?.ts ?? 0);
    const noFeed = newestTs === 0 || nowTs - newestTs > FEED_STALE_S;

    // Distance and the clocks come from the Edge even when position has fallen
    // back - the last known distance is the honest figure, and recomputing it
    // from Traccar positions would contradict the device that owns it.
    const coveredM = withDistance?.distM ?? null;
    const elapsedS = withDistance?.elapsedS ?? null;
    const timerS = withDistance?.timerS ?? null;
    const governingS = config.stoppedTimeCounts ? elapsedS : timerS;

    // The live tiles, from a bounded recent window rather than the whole ride.
    const recent = await samplesSince(nowTs - NP_WINDOW_S, "edge1040");
    const powers = recent.filter((s) => s.powerW != null).map((s) => ({ ts: s.ts, w: s.powerW as number }));
    const power30 = avg(powers.filter((p) => p.ts >= nowTs - POWER_WINDOW_S).map((p) => p.w));
    const hr5 = avg(recent.filter((s) => s.ts >= nowTs - HR_WINDOW_S && s.hrBpm != null).map((s) => s.hrBpm as number));

    let record: Record<string, Nullable> | null = null;
    let finished = false;
    if (recordIsConfigured(config) && coveredM != null && governingS != null) {
      const hourAgo = await sampleNearTimestamp(nowTs - 3600);
      const priorGoverning = config.stoppedTimeCounts ? hourAgo?.elapsedS : hourAgo?.timerS;
      const priorDelta =
        hourAgo?.distM != null && priorGoverning != null
          ? Math.round(hourAgo.distM / ((config.distanceM as number) / (config.recordSeconds as number)) - priorGoverning)
          : null;

      const computed = computeRecord({
        distanceM: config.distanceM as number,
        recordSeconds: config.recordSeconds as number,
        coveredM,
        governingS,
        deltaOneHourAgoS: priorDelta,
      });
      finished = computed.finished;
      record = {
        delta_s: computed.deltaS,
        delta_trend_s_per_hr: computed.deltaTrendSPerHr,
        required_avg_mps: computed.requiredAvgMps,
        projected_finish_s: computed.projectedFinishS,
        projected_delta_s: computed.projectedDeltaS,
      };
    }

    const started = config.attemptStartIso ? Date.parse(config.attemptStartIso) <= Date.now() : coveredM != null;
    const status = finished ? "finished" : !started ? "pending" : noFeed ? "stale" : "live";

    // Averages over the whole ride, both of them, labelled - they are different
    // numbers and an unlabelled one invites arguments.
    const avgElapsed = coveredM != null && elapsedS ? coveredM / elapsedS : null;
    const avgMoving = coveredM != null && timerS ? coveredM / timerS : null;

    res.setHeader("Cache-Control", "public, max-age=10, s-maxage=10, stale-while-revalidate=30");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({
      status,
      updated_ts: nowTs,
      config: {
        rider_name: config.riderName,
        record_holder: config.recordHolder,
        sanctioning_body: config.sanctioningBody,
        distance_m: config.distanceM,
        record_seconds: config.recordSeconds,
        stopped_time_counts: config.stoppedTimeCounts,
        // Named so the page can say which clock it is showing rather than
        // leaving the viewer to guess which of two numbers governs.
        governing_clock: config.stoppedTimeCounts ? "elapsed" : "moving",
        configured: recordIsConfigured(config),
      },
      sources: {
        edge: { last_seen_ts: edge?.ts ?? null, stale: edgeStale },
        traccar: { last_seen_ts: traccar?.ts ?? null, stale: traccarAge > EDGE_STALE_S },
      },
      position:
        positionFrom?.lat != null
          ? {
              lat: positionFrom.lat,
              lon: positionFrom.lon,
              source: positionSource,
              ts: positionFrom.ts,
              // Distinguishes "here they are" from "here they were" without
              // making the page compute an age from two timestamps.
              stale: nowTs - positionFrom.ts > EDGE_STALE_S,
              age_s: nowTs - positionFrom.ts,
            }
          : null,
      progress: {
        distance_m: coveredM,
        distance_pct:
          coveredM != null && config.distanceM ? round((coveredM / config.distanceM) * 100, 1) : null,
        elapsed_s: elapsedS,
        timer_s: timerS,
      },
      record,
      live: {
        // Sensor values are only meaningful while the Edge is current; after a
        // dropout the page keeps showing them greyed, so it needs to know.
        stale: edgeStale,
        speed_mps: edge?.speedMps ?? null,
        avg_speed_elapsed_mps: round(avgElapsed),
        avg_speed_moving_mps: round(avgMoving),
        power_30s_w: round(power30, 0),
        power_avg_w: round(avg(powers.map((p) => p.w)), 0),
        power_np_w: round(normalisedPower(powers), 0),
        hr_bpm: edge?.hrBpm ?? null,
        hr_5min_bpm: round(hr5, 0),
        cad_rpm: edge?.cadRpm ?? null,
        batt_pct: edge?.battPct ?? null,
      },
    });
  } catch (error) {
    console.error("live.json", error);
    // Short cache on the error too, so a database blip does not get pinned at
    // the edge for the length of a normal cache lifetime.
    res.setHeader("Cache-Control", "public, max-age=5");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(503).json({ status: "stale", updated_ts: nowTs, error: "Tracker data unavailable" });
  }
}
