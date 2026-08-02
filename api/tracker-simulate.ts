import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSessionEmail } from "./_lib/session.js";
import { ensureSchema, getPool, insertSamples, type TrackerSample } from "./_lib/trackerDb.js";

/**
 * A synthetic ride, so the tracker can be built and load-tested before there
 * is a bike to ride.
 *
 * Session-gated rather than token-gated on purpose: this writes fiction into
 * the samples table, and the one thing that must never happen is fiction
 * arriving during the real attempt. Only the signed-in owner can call it.
 *
 * Generates the ride at 60x: an hour of riding per minute of wall clock, which
 * is what makes a 20-hour attempt testable in twenty minutes.
 */

/**
 * It writes as "edge1040" deliberately: the merge rule treats that as the
 * primary feed, so a simulated ride has to arrive under it or the page would
 * never exercise the sensor tiles at all.
 *
 * The isolation is therefore the seq range, not the device name. Real batches
 * count up from zero; nothing simulated is written below SIM_SEQ_BASE, and the
 * clear only ever deletes at or above it. That is what keeps a reset from
 * being a foot-gun pointed at the actual record.
 */
const SIM_DEVICE = "edge1040" as const;
const SIM_SEQ_BASE = 900_000_000;

/**
 * A plausible north-south Irish route: start near Malin Head, finish near
 * Mizen. Interpolated as a straight line, which is wrong as a route and
 * entirely sufficient as a track - this exists to exercise the map, the
 * decimation and the maths, not to plan navigation.
 */
const START = { lat: 55.3722, lon: -7.3736 };
const FINISH = { lat: 51.4467, lon: -9.8206 };

type SimOptions = {
  /** Total ride distance in metres. */
  distanceM: number;
  /** How long the synthetic rider takes, seconds. */
  durationS: number;
  /** One sample per this many seconds of ride time. */
  stepS: number;
  /** Fraction of the ride spent stopped, so elapsed and timer diverge. */
  stoppedFraction: number;
};

function buildRide(options: SimOptions): TrackerSample[] {
  const { distanceM, durationS, stepS, stoppedFraction } = options;
  const startTs = Math.floor(Date.now() / 1000) - durationS;

  // Stop for one hour in every `stopEvery`, which is what actually delivers
  // the requested stopped fraction. The first version hard-coded one hour in
  // five while computing moving time from a 0.08 fraction, so the two
  // disagreed and the synthetic rider finished 74km short of the distance.
  const stopEvery = Math.max(2, Math.round(1 / Math.min(0.49, Math.max(0.01, stoppedFraction))));

  // Two passes. The clocks are built first, then distance is mapped onto the
  // moving time that actually accumulated - deriving progress from a predicted
  // moving time is what let the ride end short. Now it lands on the distance
  // exactly, whatever the stop pattern does.
  const clocks: { elapsedS: number; timerS: number; inStop: boolean }[] = [];
  let timerS = 0;
  for (let elapsedS = 0; elapsedS <= durationS; elapsedS += stepS) {
    const inStop = Math.floor(elapsedS / 3600) % stopEvery === stopEvery - 1;
    if (!inStop) timerS += stepS;
    clocks.push({ elapsedS, timerS, inStop });
  }
  const totalMovingS = clocks[clocks.length - 1]?.timerS || 1;

  return clocks.map((clock, i) => {
    const progress = Math.min(1, clock.timerS / totalMovingS);
    const speedMps = clock.inStop ? 0 : 7.6 + Math.sin(clock.elapsedS / 1800) * 1.4 + Math.sin(clock.elapsedS / 137) * 0.5;

    return {
      device: SIM_DEVICE,
      seq: SIM_SEQ_BASE + i,
      ts: startTs + clock.elapsedS,
      lat: START.lat + (FINISH.lat - START.lat) * progress,
      lon: START.lon + (FINISH.lon - START.lon) * progress,
      altM: 40 + Math.sin(clock.elapsedS / 900) * 120,
      distM: Math.round(distanceM * progress * 10) / 10,
      elapsedS: clock.elapsedS,
      timerS: clock.timerS,
      speedMps: Math.round(speedMps * 100) / 100,
      // Null while stopped rather than zero: a stopped rider has no cadence,
      // and zero would drag the averages down as though they were pedalling
      // badly. This also exercises the page's null handling.
      powerW: clock.inStop ? null : Math.round(190 + Math.sin(clock.elapsedS / 600) * 35),
      hrBpm: clock.inStop
        ? Math.round(96 + Math.sin(clock.elapsedS / 400) * 6)
        : Math.round(138 + Math.sin(clock.elapsedS / 700) * 12),
      cadRpm: clock.inStop ? null : Math.round(84 + Math.sin(clock.elapsedS / 300) * 6),
      battPct: Math.max(5, Math.round(100 - (clock.elapsedS / durationS) * 78)),
    };
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!getSessionEmail(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = (req.body ?? {}) as {
    distanceKm?: number;
    durationHours?: number;
    stepS?: number;
    stoppedFraction?: number;
    clear?: boolean;
  };

  try {
    await ensureSchema();

    if (body.clear) {
      // Only the simulated range. A clear that wiped the whole table would be
      // a foot-gun pointed at the actual record.
      const { rowCount } = await getPool().query(`DELETE FROM samples WHERE seq >= $1`, [SIM_SEQ_BASE]);
      res.status(200).json({ ok: true, cleared: rowCount ?? 0 });
      return;
    }

    const samples = buildRide({
      distanceM: (body.distanceKm ?? 570) * 1000,
      durationS: (body.durationHours ?? 20) * 3600,
      // One sample per 10 ride-seconds rather than per second: a 20-hour ride
      // at 1Hz is 72,000 rows, which is the right size for a load test but a
      // slow one to regenerate while iterating on the page.
      stepS: body.stepS ?? 10,
      stoppedFraction: body.stoppedFraction ?? 0.08,
    });

    // Chunked so no single statement approaches Postgres' parameter limit -
    // 14 columns times a few thousand rows would blow past it.
    let stored = 0;
    for (let i = 0; i < samples.length; i += 500) {
      stored += await insertSamples(samples.slice(i, i + 500));
    }

    res.status(200).json({
      ok: true,
      generated: samples.length,
      stored,
      firstTs: samples[0]?.ts,
      lastTs: samples.at(-1)?.ts,
      finalDistanceM: samples.at(-1)?.distM,
      finalElapsedS: samples.at(-1)?.elapsedS,
      finalTimerS: samples.at(-1)?.timerS,
    });
  } catch (error) {
    console.error("tracker-simulate", error);
    res.status(500).json({ error: String(error) });
  }
}
