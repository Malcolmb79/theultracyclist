import { getPool } from "./trackerDb.js";

/**
 * Measurements read off screenshots of apps that aren't integrated.
 *
 * Postgres rather than the Redis the rest of the health data uses. That store
 * is a single JSON blob trimmed to the last 365 days on every Apple Health
 * sync, which is right for a rolling dashboard and wrong for this: a lab
 * result or a body-composition scan is worth keeping for years, and there may
 * be four of them, not four hundred. Rows that are rare, permanent and
 * queried by metric belong in a table.
 *
 * Deliberately separate from the Apple Health history rather than merged into
 * it. Two stores that never meet is a real cost, but merging them would mean
 * repointing every existing health widget in the same change.
 */

export type Measurement = {
  id?: number;
  /** The date the reading refers to, not when it was uploaded. */
  measuredOn: string; // YYYY-MM-DD
  /** Normalised key a widget can query on, e.g. "resting_heart_rate". */
  metric: string;
  /** What the app itself called it, kept so the row still makes sense later. */
  label: string;
  value: number;
  unit: string | null;
  /** Which app the screenshot came from. */
  source: string;
  note: string | null;
};

let schemaReady: Promise<void> | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS measurements (
  id           bigserial   PRIMARY KEY,

  -- The date the measurement is about. Date, not timestamp: a morning HRV
  -- reading and a blood test are both facts about a day, and pretending to
  -- know the minute would invent precision the screenshot never had.
  measured_on  date        NOT NULL,

  -- Normalised, snake_case, what a widget queries on.
  metric       text        NOT NULL,
  -- Whatever the app on screen called it. Kept because normalisation is
  -- lossy and a year from now "hrv" is less use than "Heart Rate Variability
  -- (7-day avg)" when deciding whether two rows mean the same thing.
  label        text        NOT NULL,

  value        double precision NOT NULL,
  unit         text,

  -- The app the screenshot came from. Part of the key, so the same metric
  -- from two apps on the same day is two rows rather than one overwriting
  -- the other. Those numbers rarely agree and the disagreement is worth
  -- keeping.
  source       text        NOT NULL,

  note         text,
  created_ts   bigint      NOT NULL DEFAULT EXTRACT(EPOCH FROM now())::bigint,

  -- Re-uploading the same screenshot updates rather than duplicates. Doing
  -- it twice is the normal case, not the exception: it is the obvious way to
  -- correct a value that was read wrong the first time.
  UNIQUE (measured_on, metric, source)
);

-- Widgets ask for one metric over a window.
CREATE INDEX IF NOT EXISTS measurements_metric_date_idx ON measurements (metric, measured_on DESC);
-- The card itself lists whatever arrived most recently.
CREATE INDEX IF NOT EXISTS measurements_created_idx ON measurements (created_ts DESC);
`;

export function ensureMeasurementsSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = getPool()
      .query(SCHEMA)
      .then(() => undefined)
      .catch((error) => {
        // Cleared so the next request retries rather than inheriting a
        // failure for the life of the warm instance.
        schemaReady = null;
        throw error;
      });
  }
  return schemaReady;
}

/**
 * Writes approved rows. Returns how many were new versus updated, because
 * "imported 6" reads as success when 6 rows were silently overwritten.
 */
export async function saveMeasurements(rows: Measurement[]): Promise<{ inserted: number; updated: number }> {
  await ensureMeasurementsSchema();
  if (rows.length === 0) return { inserted: 0, updated: 0 };

  const pool = getPool();
  let inserted = 0;
  let updated = 0;

  for (const row of rows) {
    // xmax = 0 identifies a genuine insert; anything else was an update. It
    // is the only way to tell the two apart from ON CONFLICT.
    const result = await pool.query<{ was_insert: boolean }>(
      `INSERT INTO measurements (measured_on, metric, label, value, unit, source, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (measured_on, metric, source) DO UPDATE
         SET label = EXCLUDED.label,
             value = EXCLUDED.value,
             unit  = EXCLUDED.unit,
             note  = EXCLUDED.note
       RETURNING (xmax = 0) AS was_insert`,
      [row.measuredOn, row.metric, row.label, row.value, row.unit, row.source, row.note],
    );
    if (result.rows[0]?.was_insert) inserted++;
    else updated++;
  }

  return { inserted, updated };
}

export type StoredMeasurement = Measurement & { id: number; createdTs: number };

export async function listMeasurements(options: {
  metric?: string;
  from?: string;
  to?: string;
  limit?: number;
}): Promise<StoredMeasurement[]> {
  await ensureMeasurementsSchema();

  const where: string[] = [];
  const values: unknown[] = [];
  if (options.metric) {
    values.push(options.metric);
    where.push(`metric = $${values.length}`);
  }
  if (options.from) {
    values.push(options.from);
    where.push(`measured_on >= $${values.length}`);
  }
  if (options.to) {
    values.push(options.to);
    where.push(`measured_on <= $${values.length}`);
  }
  values.push(Math.min(Math.max(options.limit ?? 200, 1), 1000));

  const result = await getPool().query(
    `SELECT id, measured_on, metric, label, value, unit, source, note, created_ts
       FROM measurements
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY measured_on DESC, metric ASC
       LIMIT $${values.length}`,
    values,
  );

  return result.rows.map((r) => ({
    id: Number(r.id),
    // Postgres hands back a Date for a date column; the wire format everything
    // else here speaks is YYYY-MM-DD.
    measuredOn: r.measured_on instanceof Date ? r.measured_on.toISOString().slice(0, 10) : String(r.measured_on),
    metric: r.metric,
    label: r.label,
    value: Number(r.value),
    unit: r.unit ?? null,
    source: r.source,
    note: r.note ?? null,
    createdTs: Number(r.created_ts),
  }));
}

/** Distinct metrics held, so a widget picker can offer what actually exists. */
export async function listMeasurementMetrics(): Promise<{ metric: string; label: string; count: number }[]> {
  await ensureMeasurementsSchema();
  const result = await getPool().query(
    `SELECT metric, MAX(label) AS label, COUNT(*)::int AS count
       FROM measurements
       GROUP BY metric
       ORDER BY metric ASC`,
  );
  return result.rows.map((r) => ({ metric: r.metric, label: r.label, count: r.count }));
}

export async function deleteMeasurement(id: number): Promise<boolean> {
  await ensureMeasurementsSchema();
  const result = await getPool().query(`DELETE FROM measurements WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}
