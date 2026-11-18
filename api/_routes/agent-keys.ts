import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSession, requirePasskeySession } from "../_lib/session.js";
import { createAgentKey, listAgentKeys, revokeAgentKey, summary } from "../_lib/agentAccess.js";

/**
 * The athlete's AI agent keys (api/_lib/agentAccess.ts): list them, make one,
 * revoke one. Held to the coaching page's bar - a passkey session - because a
 * key reads the coaching data too. Agents themselves can't reach this: the
 * router refuses agent keys for every route not on their read list.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requirePasskeySession(req, res)) return;
  const email = getSession(req)!.email;
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "GET") {
      res.status(200).json({ keys: (await listAgentKeys()).map(summary) });
      return;
    }
    if (req.method === "POST") {
      const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
      res.status(200).json(await createAgentKey(email, name));
      return;
    }
    if (req.method === "DELETE") {
      const id = String(req.query.id ?? "");
      res.status((await revokeAgentKey(id)) ? 200 : 404).json({ ok: true });
      return;
    }
    res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    res.status(503).json({ error: e instanceof Error ? e.message : "Storage is unavailable right now." });
  }
}
