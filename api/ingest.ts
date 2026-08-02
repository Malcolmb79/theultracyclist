import type { VercelRequest, VercelResponse } from "@vercel/node";
import { insertSamples, type TrackerDevice, type TrackerSample } from "./_lib/trackerDb.js";

/**
 * Where the Edge's batches land.
 *
 * Deliberately dull and deliberately forgiving. This runs once, for hours,
 * from a device on a bike in rural Ireland, and the failure it must survive is
 * not a clever attack but a signal blackspot: batches arrive late, out of
 * order, and more than once. All three are normal here, not errors.
 *
 * Bearer token rather than a session: the device has no cookie jar and no
 * login. The token is the only thing standing between the record and someone
 * writing fiction into it, so a missing or wrong one is rejected before the
 * body is even parsed.
 */

// The spec's limit. Rejecting with 413 rather than truncating tells the device
// to split and retry, which it can do; silently dropping the tail would leave
// a hole nobody notices until afterwards.
const MAX_BODY_BYTES = 256 * 1024;
const KNOWN_DEVICES = new Set<TrackerDevice>(["edge1040", "traccar"]);

type IncomingSample = {
  seq?: number;
  ts?: number;
  lat?: number | null;
  lon?: number | null;
  alt_m?: number | null;
  dist_m?: number | null;
  elapsed_s?: number | null;
  timer_s?: number | null;
  speed_mps?: number | null;
  power_w?: number | null;
  hr_bpm?: number | null;
  cad_rpm?: number | null;
  batt_pct?: number | null;
};

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const expected = process.env.INGEST_TOKEN;
  if (!expected) {
    // Refusing to accept anything is the right failure: an unauthenticated
    // ingest would let anyone write the record.
    res.status(503).json({ error: "Ingest is not configured" });
    return;
  }
  const offered = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  if (offered !== expected) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const length = Number(req.headers["content-length"] ?? 0);
  if (length > MAX_BODY_BYTES) {
    res.status(413).json({ error: "Batch too large - split it", maxBytes: MAX_BODY_BYTES });
    return;
  }

  const body = (req.body ?? {}) as { device?: string; batch_seq?: number; samples?: IncomingSample[] };
  const device = body.device as TrackerDevice | undefined;
  if (!device || !KNOWN_DEVICES.has(device)) {
    res.status(400).json({ error: "Unknown device" });
    return;
  }
  if (!Array.isArray(body.samples) || body.samples.length === 0) {
    res.status(400).json({ error: "No samples" });
    return;
  }

  // A sample without seq and ts cannot be stored idempotently or ordered, so
  // it is dropped rather than given a made-up one. Everything else about a
  // sample may legitimately be missing.
  const samples: TrackerSample[] = [];
  let skipped = 0;
  for (const raw of body.samples) {
    const seq = num(raw.seq);
    const ts = num(raw.ts);
    if (seq == null || ts == null) {
      skipped += 1;
      continue;
    }
    samples.push({
      device,
      seq,
      ts,
      lat: num(raw.lat),
      lon: num(raw.lon),
      altM: num(raw.alt_m),
      distM: num(raw.dist_m),
      elapsedS: num(raw.elapsed_s),
      timerS: num(raw.timer_s),
      speedMps: num(raw.speed_mps),
      powerW: num(raw.power_w),
      hrBpm: num(raw.hr_bpm),
      cadRpm: num(raw.cad_rpm),
      battPct: num(raw.batt_pct),
    });
  }

  try {
    const stored = await insertSamples(samples);
    // `stored` below `received` means duplicates were re-sent, which is the
    // system working. It is reported rather than hidden so a retry storm is
    // visible in the device logs if anyone goes looking afterwards.
    res.status(200).json({ ok: true, received: samples.length, stored, duplicates: samples.length - stored, skipped });
  } catch (error) {
    console.error("ingest", error);
    // 5xx, not 4xx: the device should keep this batch queued and retry, and a
    // 4xx would tell it the batch itself was bad and to give up on it.
    res.status(503).json({ error: "Storage unavailable - retry" });
  }
}
