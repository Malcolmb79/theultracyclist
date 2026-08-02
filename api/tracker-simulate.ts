import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSessionEmail } from "./_lib/session.js";
import { ensureSchema, getPool, insertSamples, type TrackerSample } from "./_lib/trackerDb.js";

/**
 * A synthetic ride, so the tracker can be built and load-tested before there
 * is a bike to ride.
 *
 * Session-gated rather than token-gated on purpose: this writes fiction into
 * the samples table, and the one thing that must never happen is fiction
 * arriving during the real attempt. Only the signed-in owner can call it, it
 * refuses to touch a table that already holds real Edge samples unless told
 * to, and everything it writes is under a device name that is not the Edge's.
 *
 * Generates the ride at 60x: an hour of riding per minute of wall clock, which
 * is what makes a 20-hour attempt testable in twenty minutes.
 */

// Not "edge1040", so a simulated ride can never be mistaken for the real feed
// and can always be deleted by device name.
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
  const samples: TrackerSample[] = [];
  const startTs = Math.floor(Date.now() / 1000) - durationS;
  const movingS = durationS * (1 - stoppedFraction);

  let timerS = 0;
  for (let elapsedS = 0, i = 0; elapsedS <= durationS; elapsedS += stepS, i++) {
    // Stops clustered rather than spread evenly - a rider takes a handful of
    // real breaks, and clustering is what makes elapsed and timer diverge in
    // the stepped way the page has to render.
    const inStop = Math.floor(elapsedS / 3600) % 5 === 4;
    if (!inStop) timerS += stepS;

    const progress = Math.min(1, timerS / movingS);
    const distM = distanceM * progress;
    // Speed varies with a slow sinusoid plus terrain-ish noise, so the live
    // tiles move and the projection has something to smooth over.
    const speedMps = inStop ? 0 : 7.6 + Math.sin(elapsedS / 1800) * 1.4 + Math.sin(elapsedS / 137) * 0.5;

    samples.push({
      device: SIM_DEVICE,
      seq: SIM_SEQ_BASE + i,
      ts: startTs + elapsedS,
      lat: START.lat + (FINISH.lat - START.lat) * progress,
      lon: START.lon + (FINISH.lon - START.lon) * progress,
      altM: 40 + Math.sin(elapsedS / 900) * 120,
      distM: Math.round(distM * 10) / 10,
      elapsedS,
      timerS,
      speedMps: Math.round(speedMps * 100) / 100,
      // Null while stopped rather than zero: a stopped rider has no cadence,
      // and zero would drag the averages down as though they were pedalling
      // badly. This also exercises the page's null handling.
      powerW: inStop ? null : Math.round(190 + Math.sin(elapsedS / 600) * 35),
      hrBpm: inStop ? Math.round(96 + Math.sin(elapsedS / 400) * 6) : Math.round(138 + Math.sin(elapsedS / 700) * 12),
      cadRpm: inStop ? null : Math.round(84 + Math.sin(elapsedS / 300) * 6),
      battPct: Math.max(5, Math.round(100 - (elapsedS / durationS) * 78)),
    });
  }
  return samples;
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
