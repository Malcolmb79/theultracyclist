import type { VercelRequest, VercelResponse } from "@vercel/node";
import { insertSamples, type TrackerSample } from "./_lib/trackerDb.js";

/**
 * Where the phone's positions land.
 *
 * Modern Traccar Client doesn't speak a proprietary wire protocol - it POSTs
 * (or GETs) to whatever "Server URL" is configured, using the OsmAnd
 * protocol: `id`, `lat`, `lon`, `timestamp`, etc. as query/body parameters.
 * That means there is no real Traccar server in this picture at all; this
 * endpoint just needs to speak the same protocol the app already sends,
 * which is why it lives here as an ordinary function next to ingest.ts
 * rather than as a separate service.
 *
 * The app has no header/token field, so `id` doubles as the credential -
 * whatever string is configured as the device ID in Traccar Client is
 * compared against TRACCAR_DEVICE_TOKEN below. Treat that value as a
 * password, not a device name.
 */

function num(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(Array.isArray(value) ? value[0] : value);
  return Number.isFinite(n) ? n : null;
}

// OsmAnd timestamps arrive in seconds, milliseconds, or occasionally an ISO
// string, depending on client and version - normalised to whole seconds to
// match every other sample in the table (see trackerDb.ts's `ts` column).
function toEpochSeconds(raw: unknown): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value == null) return null;
  if (typeof value === "string" && /[^0-9.]/.test(value)) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  const expected = process.env.TRACCAR_DEVICE_TOKEN;
  if (!expected) {
    res.status(503).send("Not configured");
    return;
  }

  // OsmAnd protocol supports both query and body parameters; the client can
  // send either depending on GET vs POST, so both are checked.
  const params = { ...(req.query as Record<string, unknown>), ...(req.body as Record<string, unknown> | undefined) };

  const deviceId = params.id ?? params.deviceid;
  const offered = Array.isArray(deviceId) ? deviceId[0] : deviceId;
  if (offered !== expected) {
    res.status(401).send("Unauthorized");
    return;
  }

  const lat = num(params.lat);
  const lon = num(params.lon);
  const ts = toEpochSeconds(params.timestamp) ?? Math.floor(Date.now() / 1000);

  // No seq field in this protocol - each ping is timestamped by the phone's
  // clock in whole seconds, which is a fine idempotency key on its own
  // (device, seq) is the primary key in trackerDb.ts, so ts doubles as seq
  // here rather than inventing a counter the client has no way to send.
  const sample: TrackerSample = {
    device: "traccar",
    seq: ts,
    ts,
    lat,
    lon,
    altM: num(params.altitude),
    distM: null,
    elapsedS: null,
    timerS: null,
    speedMps: num(params.speed),
    powerW: null,
    hrBpm: null,
    cadRpm: null,
    battPct: num(params.batt) ?? num(params.batt_level),
  };

  try {
    await insertSamples([sample]);
    // Traccar Client only checks the HTTP status, not the body - plain text
    // matches what a real Traccar server would send back.
    res.status(200).send("OK");
  } catch (error) {
    console.error("traccar-osmand", error);
    res.status(503).send("Storage unavailable - retry");
  }
}
