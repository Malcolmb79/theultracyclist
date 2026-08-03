import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requirePasskeySession } from "./_lib/session.js";
import { addDocument, documentChunks, listDocuments, removeDocument, searchKnowledge } from "./_lib/coachKnowledge.js";

/**
 * Manage the coach's knowledge base: add source material, list what's stored,
 * remove it. Session-gated throughout - this is the athlete's own coaching
 * material, and whatever is in here shapes every answer the coach gives.
 *
 * The search action exists for checking that a document is actually findable
 * before relying on it; the coach reaches searchKnowledge directly in-process
 * rather than through HTTP.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Coaching is passkey-gated, unlike the rest of the dashboard - see
  // requirePasskeySession. It answers on failure, including the code the
  // client needs to offer a passkey prompt rather than a sign-in page.
  if (!requirePasskeySession(req, res)) return;

  try {
    if (req.method === "POST") {
      const body = req.body as { title?: string; text?: string };
      if (!body.text?.trim()) {
        res.status(400).json({ error: "No text to store." });
        return;
      }
      const doc = await addDocument(body.title ?? "", body.text);
      res.status(200).json({ ok: true, doc });
      return;
    }

    if (req.method === "DELETE") {
      const id = (req.query.id as string) ?? (req.body as { id?: string } | undefined)?.id;
      if (!id) {
        res.status(400).json({ error: "Which document?" });
        return;
      }
      await removeDocument(id);
      res.status(200).json({ ok: true });
      return;
    }

    // Read back exactly what was stored - a character count is not evidence
    // that the right thing went in.
    const previewId = typeof req.query.preview === "string" ? req.query.preview : "";
    if (previewId) {
      res.status(200).json({ chunks: await documentChunks(previewId) });
      return;
    }

    const query = typeof req.query.q === "string" ? req.query.q : "";
    if (query) {
      res.status(200).json({ hits: await searchKnowledge(query, 5) });
      return;
    }

    res.status(200).json({ documents: await listDocuments() });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Knowledge request failed." });
  }
}
