import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Where browsers report what the Content-Security-Policy blocked (the
 * report-uri in vercel.json). The policy names each outside service the site
 * uses rather than allowing any https origin, so a service it missed - a
 * new image host, say - shows up here in the function logs instead of failing
 * silently on the page.
 *
 * Anyone can post here, so it only ever logs a few trimmed fields and never
 * echoes anything back.
 */

const MAX_FIELD = 200;

function field(value: unknown): string | undefined {
  return typeof value === "string" ? value.slice(0, MAX_FIELD) : undefined;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).end();
    return;
  }
  let body: unknown = req.body;
  if (typeof body === "string" || Buffer.isBuffer(body)) {
    try {
      body = JSON.parse(String(body).slice(0, 10_000));
    } catch {
      body = null;
    }
  }
  const report = (body as { "csp-report"?: Record<string, unknown> } | null)?.["csp-report"];
  if (report) {
    console.warn(
      "CSP violation",
      JSON.stringify({
        page: field(report["document-uri"]),
        directive: field(report["effective-directive"] ?? report["violated-directive"]),
        blocked: field(report["blocked-uri"]),
      }),
    );
  }
  res.status(204).end();
}
