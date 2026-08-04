import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSessionEmail } from "./_lib/session.js";
import {
  deleteMeasurement,
  listMeasurementMetrics,
  listMeasurements,
  saveMeasurements,
  type Measurement,
} from "./_lib/measurementsDb.js";

/**
 * The measurements store: read, write approved rows, delete a mistake.
 *
 * Every method needs a session. Unlike the tracker feeds there is no public
 * side to this at all - it holds body composition and blood work, which is
 * the most private data on the system.
 *
 * Writing is deliberately separate from api/measurements-extract.ts. That
 * endpoint reads a screenshot and returns what it found; this one only ever
 * stores rows the athlete has approved. Nothing a model produced reaches the
 * table without passing through a person first.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseRows(input: unknown): { rows: Measurement[]; error?: string } {
  if (!Array.isArray(input)) return { rows: [], error: "Expected a list of measurements." };
  if (input.length === 0) return { rows: [], error: "Nothing to import." };
  if (input.length > 200) return { rows: [], error: "That is more than one screenshot's worth." };

  const rows: Measurement[] = [];
  for (const raw of input) {
    const r = raw as Partial<Measurement>;
    if (!r || typeof r.metric !== "string" || !r.metric.trim()) {
      return { rows: [], error: "One of those rows has no metric name." };
    }
    if (typeof r.value !== "number" || !Number.isFinite(r.value)) {
      return { rows: [], error: `"${r.label ?? r.metric}" has no usable value.` };
    }
    if (typeof r.measuredOn !== "string" || !DATE.test(r.measuredOn)) {
      return { rows: [], error: `"${r.label ?? r.metric}" needs a date.` };
    }
    if (typeof r.source !== "string" || !r.source.trim()) {
      return { rows: [], error: "Every row needs a source app." };
    }
    rows.push({
      measuredOn: r.measuredOn,
      metric: r.metric.trim().toLowerCase().replace(/\s+/g, "_").slice(0, 64),
      label: (r.label ?? r.metric).toString().trim().slice(0, 120),
      value: r.value,
      unit: r.unit ? r.unit.toString().trim().slice(0, 24) : null,
      source: r.source.trim().slice(0, 60),
      note: r.note ? r.note.toString().trim().slice(0, 500) : null,
    });
  }
  return { rows };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!getSessionEmail(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  res.setHeader("Cache-Control", "no-store");

  try {
    if (req.method === "POST") {
      const body = (req.body ?? {}) as { measurements?: unknown };
      const { rows, error } = parseRows(body.measurements);
      if (error) {
        res.status(400).json({ error });
        return;
      }
      const result = await saveMeasurements(rows);
      res.status(200).json({ ok: true, ...result });
      return;
    }

    if (req.method === "DELETE") {
      const id = Number(req.query.id);
      if (!Number.isInteger(id)) {
        res.status(400).json({ error: "Which measurement?" });
        return;
      }
      const removed = await deleteMeasurement(id);
      res.status(removed ? 200 : 404).json(removed ? { ok: true } : { error: "That measurement is already gone." });
      return;
    }

    if (req.method === "GET") {
      if (req.query.metrics !== undefined) {
        res.status(200).json({ metrics: await listMeasurementMetrics() });
        return;
      }
      const measurements = await listMeasurements({
        metric: typeof req.query.metric === "string" ? req.query.metric : undefined,
        from: typeof req.query.from === "string" && DATE.test(req.query.from) ? req.query.from : undefined,
        to: typeof req.query.to === "string" && DATE.test(req.query.to) ? req.query.to : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });
      res.status(200).json({ measurements });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("measurements", error);
    res.status(500).json({ error: "The measurements store is unavailable right now." });
  }
}
