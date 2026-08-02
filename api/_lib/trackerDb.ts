import { Pool } from "pg";

/**
 * Storage for the live record tracker.
 *
 * One table. Every sample from every source lands in it, tagged with which
 * device sent it, because the merge rule needs to know the provenance of each
 * position rather than just its coordinates - "prefer Connect IQ, fall back to
 * Traccar, never interleave" is only expressible if the source survives into
 * storage.
 *
 * Postgres rather than the Redis this project already uses: the history
 * endpoint has to decimate a 20-hour ride down to 2000 points, and doing that
 * from a Redis list means pulling all 72,000 samples into a serverless
 * function on every cache miss. A stride query does it in the database.
 */

// One device is a bar-mounted Edge and one is a phone. The set is closed, and
// keeping it closed means a typo in the device field is a rejected batch
// rather than a silent third track nobody is watching.
export type TrackerDevice = "edge1040" | "traccar";

export type TrackerSample = {
  device: TrackerDevice;
  seq: number;
  ts: number;
  lat: number | null;
  lon: number | null;
  altM: number | null;
  distM: number | null;
  elapsedS: number | null;
  timerS: number | null;
  speedMps: number | null;
  powerW: number | null;
  hrBpm: number | null;
  cadRpm: number | null;
  battPct: number | null;
  // Ride-wide figures as the head unit itself computes them, rather than
  // re-derived here from the samples. Ascent especially: summing altitude
  // deltas from 30-second samples would accumulate barometric noise, while
  // the Edge filters it properly.
  avgSpeedMps: number | null;
  avgPowerW: number | null;
  avgHrBpm: number | null;
  totalAscentM: number | null;
};

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

/**
 * Cached across warm invocations. A serverless function that opens a
 * connection per request will exhaust a Postgres connection limit long before
 * it exhausts anything else - `max` is deliberately small for the same reason,
 * since many concurrent lambdas each holding a handful of connections is how
 * that limit gets hit.
 */
export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not configured");
    pool = new Pool({
      connectionString,
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });
    pool.on("error", (error) => console.error("Postgres pool error", error));
  }
  return pool;
}

/**
 * Creates the table if it is missing, once per instance.
 *
 * A single table with no history of alterations does not justify a migration
 * runner; what it does justify is never running the DDL twice concurrently,
 * hence the cached promise. `IF NOT EXISTS` throughout means a cold start
 * during the attempt costs one cheap no-op rather than an error.
 */
export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = getPool()
      .query(SCHEMA)
      .then(() => undefined)
      .catch((error) => {
        // Don't cache a failure - the next request should try again rather
        // than inherit a broken instance for the rest of its life.
        schemaReady = null;
        throw error;
      });
  }
  return schemaReady;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS samples (
  device       text        NOT NULL,
  -- Monotonic per-device counter that survives app restarts. This is the
  -- idempotency key: batches arrive out of order after a blackspot and get
  -- retried after a failed flush, so the same sample will be offered more
  -- than once and must land once.
  seq          bigint      NOT NULL,
  -- Unix seconds from the device, not server receipt time. Stored as bigint
  -- rather than timestamptz so it round-trips exactly as sent and carries no
  -- timezone question of its own; received_ts is what records arrival.
  ts           bigint      NOT NULL,

  lat          double precision,
  lon          double precision,
  alt_m        double precision,

  -- Taken from the Edge, never recomputed from GPS. A rewound distance
  -- counter is the one corruption the page cannot survive.
  dist_m       double precision,
  elapsed_s    integer,
  timer_s      integer,

  -- Every sensor field is nullable on purpose: a dropped HR strap must not
  -- invalidate an otherwise good batch.
  speed_mps    double precision,
  power_w      integer,
  hr_bpm       integer,
  cad_rpm      integer,
  batt_pct     integer,

  received_ts  bigint      NOT NULL DEFAULT EXTRACT(EPOCH FROM now())::bigint,

  PRIMARY KEY (device, seq)
);

-- The history endpoint walks the whole ride in time order.
CREATE INDEX IF NOT EXISTS samples_ts_idx ON samples (ts);

-- The live endpoint wants the newest sample per device, which is the hottest
-- query on the system and the one a thousand dot-watchers are indirectly
-- waiting on.
CREATE INDEX IF NOT EXISTS samples_device_ts_idx ON samples (device, ts DESC);

-- Only rows with a fix are worth walking for the map track, and on a long
-- ride the no-fix rows are a real fraction of the table.
CREATE INDEX IF NOT EXISTS samples_track_idx ON samples (ts) WHERE lat IS NOT NULL;

-- Added after the table already existed on production, so CREATE TABLE IF
-- NOT EXISTS above will never introduce them - it does nothing at all once
-- the table is there. ADD COLUMN IF NOT EXISTS is idempotent, so this stays
-- safe to run on every cold start, same as the rest of this DDL.
ALTER TABLE samples ADD COLUMN IF NOT EXISTS avg_speed_mps  double precision;
ALTER TABLE samples ADD COLUMN IF NOT EXISTS avg_power_w    integer;
ALTER TABLE samples ADD COLUMN IF NOT EXISTS avg_hr_bpm     integer;
ALTER TABLE samples ADD COLUMN IF NOT EXISTS total_ascent_m double precision;
`;

/**
 * Upserts a batch, ignoring anything already stored.
 *
 * One statement rather than a loop: a 30-sample batch as 30 round-trips is
 * thirty times the latency for no benefit, and it would not be atomic.
 * `DO NOTHING` is what makes a retried batch harmless - the device cannot know
 * whether a flush that timed out actually landed, so it will send it again.
 */
export async function insertSamples(samples: TrackerSample[]): Promise<number> {
  if (samples.length === 0) return 0;
  await ensureSchema();

  const columns = [
    "device", "seq", "ts", "lat", "lon", "alt_m", "dist_m", "elapsed_s",
    "timer_s", "speed_mps", "power_w", "hr_bpm", "cad_rpm", "batt_pct",
    "avg_speed_mps", "avg_power_w", "avg_hr_bpm", "total_ascent_m",
  ];
  const values: unknown[] = [];
  const rows = samples.map((sample, row) => {
    values.push(
      sample.device, sample.seq, sample.ts, sample.lat, sample.lon, sample.altM,
      sample.distM, sample.elapsedS, sample.timerS, sample.speedMps,
      sample.powerW, sample.hrBpm, sample.cadRpm, sample.battPct,
      sample.avgSpeedMps, sample.avgPowerW, sample.avgHrBpm, sample.totalAscentM,
    );
    const base = row * columns.length;
    return `(${columns.map((_, i) => `$${base + i + 1}`).join(", ")})`;
  });

  const result = await getPool().query(
    `INSERT INTO samples (${columns.join(", ")}) VALUES ${rows.join(", ")}
     ON CONFLICT (device, seq) DO NOTHING`,
    values,
  );
  return result.rowCount ?? 0;
}

// No Connect IQ sample for this long and position falls back to Traccar -
// shared by every consumer of the merge rule (api/live.json.ts and
// api/live-tracker.ts) so the two can't quietly drift out of sync with each
// other about what counts as stale.
export const EDGE_STALE_S = 180;

/**
 * How old the Edge's sensor readings have to be before they stop counting as
 * current. Deliberately NOT EDGE_STALE_S.
 *
 * That 180s threshold is the right answer for position, where the question is
 * "should Traccar take over?" and switching early is cheap. It is the wrong
 * answer for telemetry, because there is no second source to switch to and the
 * Edge cannot physically report more often than every 5 minutes: Connect IQ
 * won't fire a background temporal event on a shorter interval, and a data
 * field can't make web requests from the foreground at all. Judging a 5-minute
 * pipeline against a 3-minute deadline marks a perfectly healthy feed stale for
 * two minutes out of every five.
 *
 * 7 minutes: comfortably past one flush interval, so a single missed or slow
 * flush doesn't cry wolf, but well short of the point where nobody would call
 * the numbers live.
 */
export const TELEMETRY_STALE_S = 420;

/**
 * No sample from *any* device for this long and the tracker counts as stopped.
 *
 * This is what "is the attempt underway right now" should be answered with, in
 * preference to a hand-set start time in config: the tracker starting and
 * stopping is the actual event, and a start time typed in beforehand is only a
 * prediction of it. A ride that starts late, pauses, or ends early is then
 * described correctly without anyone editing anything mid-attempt.
 *
 * Same 7 minutes as TELEMETRY_STALE_S, for the same underlying reason - the
 * Edge cannot flush more often than every 5 minutes, so any shorter window
 * would declare a perfectly healthy tracker "stopped" in the gap between two
 * batches. Traccar normally reports far more often than that and will usually
 * be what keeps this true, but it can't be depended on: it's a phone app that
 * can be killed, and the Edge is the device that's actually bolted to the bike.
 */
export const TRACKING_IDLE_S = TELEMETRY_STALE_S;

/**
 * Silence for this long and the session is treated as over, not merely quiet.
 *
 * Deliberately far longer than TRACKING_IDLE_S, because the two answer
 * different questions and getting them confused is expensive in opposite
 * directions. "Is it live right now" wants a short fuse - seven minutes, one
 * flush interval plus slack. "Has the attempt finished" must not fire on a
 * dropout, and a 570km ride through rural Ireland will have dropouts far
 * longer than seven minutes.
 *
 * So a gap under 30 minutes reads as lost signal and the last numbers stand
 * as the last known ones; beyond that the page calls the session finished and
 * freezes them as the result.
 *
 * This is inference, not a signal from the device. The Edge doesn't currently
 * report its timer state, so pressing stop and riding into a valley look
 * identical from here until enough time passes. Sending Activity.Info's
 * timerState would make it definite, at the cost of another app build.
 */
export const SESSION_ENDED_S = 1800;

/**
 * One source per segment, never interleaved: whichever is chosen supplies
 * the position. Prefers a fresh Edge fix; falls back to Traccar, then to
 * the Edge's own last fix even if stale (a rider in a valley is not a
 * missing rider - returning null here would blank the map marker at
 * exactly the moment people are refreshing hardest).
 */
export function mergePosition(
  edge: (TrackerSample & { receivedTs: number }) | null,
  traccar: (TrackerSample & { receivedTs: number }) | null,
  nowTs: number,
): (TrackerSample & { receivedTs: number }) | null {
  const edgeStale = edge ? nowTs - edge.ts > EDGE_STALE_S : true;
  const fresh = !edgeStale && edge?.lat != null ? edge : null;
  return fresh ?? (traccar?.lat != null ? traccar : edge?.lat != null ? edge : null);
}

/** The newest sample from each device, for the merge rule and staleness. */
export async function latestPerDevice(): Promise<Record<string, TrackerSample & { receivedTs: number }>> {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT DISTINCT ON (device) * FROM samples ORDER BY device, ts DESC`,
  );
  const out: Record<string, TrackerSample & { receivedTs: number }> = {};
  for (const row of rows) out[row.device] = fromRow(row);
  return out;
}

/**
 * The newest sample carrying distance, which is not always the newest sample.
 *
 * Traccar sends position only, so on a Connect IQ dropout the latest row has
 * no distance at all. Falling back to "no distance" there would zero the hero
 * mid-ride; the last known distance is the honest answer, flagged stale by the
 * caller.
 */
export async function latestWithDistance(): Promise<(TrackerSample & { receivedTs: number }) | null> {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT * FROM samples WHERE dist_m IS NOT NULL ORDER BY ts DESC LIMIT 1`,
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

/**
 * The governing clock as it stood roughly an hour ago, for the delta trend.
 * Nearest sample at or before the cutoff rather than an exact match - samples
 * are one per second but gaps happen, and an exact-timestamp lookup would
 * return nothing precisely when the trend is most interesting.
 */
export async function sampleNearTimestamp(ts: number): Promise<(TrackerSample & { receivedTs: number }) | null> {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT * FROM samples WHERE ts <= $1 AND dist_m IS NOT NULL ORDER BY ts DESC LIMIT 1`,
    [ts],
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

/**
 * The map track, decimated in the database to at most `limit` points.
 *
 * Every-Nth-point rather than Douglas-Peucker: the stride is computable from a
 * row count in one pass, whereas simplification needs the whole geometry in
 * memory - the thing this is trying to avoid. At 2000 points across 570km that
 * is a point every 285 metres, which no phone screen can tell from the full
 * trace.
 */
export async function trackPoints(limit = 2000): Promise<{ lat: number; lon: number; ts: number; device: string }[]> {
  await ensureSchema();
  const { rows } = await getPool().query(
    `WITH fixes AS (
       SELECT lat, lon, ts, device, row_number() OVER (ORDER BY ts) AS rn, count(*) OVER () AS total
       FROM samples WHERE lat IS NOT NULL AND lon IS NOT NULL
     )
     SELECT lat, lon, ts, device FROM fixes
     WHERE rn % GREATEST(1, (total / $1)::bigint) = 0
        -- The final fix is where the rider is; a stride that skips it leaves
        -- the track ending short of the marker.
        OR rn = total
     ORDER BY ts`,
    [limit],
  );
  return rows.map((row) => ({ lat: Number(row.lat), lon: Number(row.lon), ts: Number(row.ts), device: String(row.device) }));
}

/**
 * Samples since a timestamp, for the rolling windows the live tiles need.
 *
 * Bounded by time rather than by row count so the window means the same thing
 * whatever the sample rate - "the last 30 minutes" has to survive the Edge
 * flushing at 1Hz and Traccar trickling at 0.1Hz.
 */
export async function samplesSince(ts: number, device?: TrackerDevice): Promise<(TrackerSample & { receivedTs: number })[]> {
  await ensureSchema();
  const { rows } = device
    ? await getPool().query(`SELECT * FROM samples WHERE ts >= $1 AND device = $2 ORDER BY ts`, [ts, device])
    : await getPool().query(`SELECT * FROM samples WHERE ts >= $1 ORDER BY ts`, [ts]);
  return rows.map(fromRow);
}

function fromRow(row: Record<string, unknown>): TrackerSample & { receivedTs: number } {
  const num = (value: unknown): number | null => (value == null ? null : Number(value));
  return {
    device: String(row.device) as TrackerDevice,
    seq: Number(row.seq),
    ts: Number(row.ts),
    lat: num(row.lat),
    lon: num(row.lon),
    altM: num(row.alt_m),
    distM: num(row.dist_m),
    elapsedS: num(row.elapsed_s),
    timerS: num(row.timer_s),
    speedMps: num(row.speed_mps),
    powerW: num(row.power_w),
    hrBpm: num(row.hr_bpm),
    cadRpm: num(row.cad_rpm),
    battPct: num(row.batt_pct),
    avgSpeedMps: num(row.avg_speed_mps),
    avgPowerW: num(row.avg_power_w),
    avgHrBpm: num(row.avg_hr_bpm),
    totalAscentM: num(row.total_ascent_m),
    receivedTs: Number(row.received_ts),
  };
}
