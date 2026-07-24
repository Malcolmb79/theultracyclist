import type { VercelRequest, VercelResponse } from "@vercel/node";

// Simple shared-password gate, not a real auth system: this only guards
// the curated dashboard page itself. The underlying data endpoints
// (strava-activities, whoop-data, health-data) are already unauthenticated
// and used by public pages, so this doesn't add real data confidentiality —
// it's just a casual deterrent against a stumbled-upon link.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const password = process.env.DASHBOARD_PASSWORD;
  const body = req.body as { password?: string };

  if (!password || body.password !== password) {
    res.status(401).json({ ok: false });
    return;
  }

  res.status(200).json({ ok: true });
}
