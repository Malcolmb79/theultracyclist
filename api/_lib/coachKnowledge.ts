import { getJSON, setJSON } from "./kvStore.js";

/**
 * A searchable knowledge base for the coach.
 *
 * The prompt-level context in coachContext.ts is right for a few pages of
 * durable methodology, because it rides in every request and is cached. Actual
 * source material - a coach's plan, nutrition protocols, race reports - is too
 * big for that: it would be re-sent on every WhatsApp message whether relevant
 * or not. So documents are chunked, stored, and retrieved a few passages at a
 * time by a tool the coach calls when it needs them.
 *
 * Search is lexical rather than embedding-based on purpose. Embeddings would
 * mean another API, another key and a per-document cost, and for a corpus this
 * size - one athlete's training material, not a library - scoring on terms does
 * the job. Worth revisiting if the corpus grows or if searches start missing
 * things phrased differently to the source.
 */

const KV_KEY = "COACH_KNOWLEDGE";

// Big enough to hold a whole idea, small enough that several fit in a tool
// result without crowding out the conversation.
const CHUNK_TARGET_CHARS = 1200;
const CHUNK_OVERLAP_CHARS = 150;

// Guards against one paste filling the store; the whole thing is read on every
// search, so it has to stay a sensible size.
export const MAX_DOCUMENT_CHARS = 200_000;
const MAX_TOTAL_CHARS = 1_000_000;

export type KnowledgeChunk = { docId: string; title: string; index: number; text: string };
export type KnowledgeDoc = { id: string; title: string; chars: number; chunkCount: number; addedAt: string };
type Store = { docs: KnowledgeDoc[]; chunks: KnowledgeChunk[] };

async function read(): Promise<Store> {
  return (await getJSON<Store>(KV_KEY)) ?? { docs: [], chunks: [] };
}

/**
 * Splits on blank lines first so a chunk is whole paragraphs wherever possible,
 * falling back to a hard split only for a paragraph longer than the target.
 * Overlap carries a little of the previous chunk forward, so a passage that
 * straddles a boundary is still findable from either side.
 */
export function chunkText(text: string): string[] {
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  const push = () => {
    if (!current.trim()) return;
    chunks.push(current.trim());
    current = current.slice(Math.max(0, current.length - CHUNK_OVERLAP_CHARS));
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > CHUNK_TARGET_CHARS) {
      push();
      for (let i = 0; i < paragraph.length; i += CHUNK_TARGET_CHARS) {
        chunks.push(paragraph.slice(i, i + CHUNK_TARGET_CHARS).trim());
      }
      current = "";
      continue;
    }
    if (current.length + paragraph.length + 2 > CHUNK_TARGET_CHARS) push();
    current += (current ? "\n\n" : "") + paragraph;
  }
  push();

  return chunks.filter((c) => c.length > 0);
}

// Words that appear in almost any sentence carry no signal and would otherwise
// let a long chunk outrank a relevant short one purely on length.
const STOPWORDS = new Set(
  ("a an and are as at be but by for from had has have how i if in into is it its of on or that the their then there " +
    "these they this to was were what when where which who will with you your do does did can could should would")
    .split(" "),
);

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

export type KnowledgeHit = { title: string; text: string; score: number };

/**
 * Term-frequency scoring with a rarity weight, so a match on "polarised" counts
 * for far more than a match on "training" in a corpus that is all about
 * training. A phrase hit is boosted separately: someone asking about "sweet
 * spot" means the phrase, not two common words.
 */
export async function searchKnowledge(query: string, limit = 4): Promise<KnowledgeHit[]> {
  const { chunks } = await read();
  if (chunks.length === 0) return [];

  const terms = [...new Set(tokenise(query))];
  if (terms.length === 0) return [];

  const docFreq = new Map<string, number>();
  const tokenised = chunks.map((chunk) => {
    const tokens = new Set(tokenise(chunk.text));
    for (const term of terms) if (tokens.has(term)) docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    return tokens;
  });

  const phrase = query.trim().toLowerCase();
  const scored = chunks.map((chunk, i) => {
    let score = 0;
    for (const term of terms) {
      if (!tokenised[i].has(term)) continue;
      const rarity = Math.log(1 + chunks.length / (docFreq.get(term) ?? 1));
      score += rarity;
    }
    if (phrase.length > 6 && chunk.text.toLowerCase().includes(phrase)) score += 3;
    return { title: chunk.title, text: chunk.text, score };
  });

  return scored
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export async function listDocuments(): Promise<KnowledgeDoc[]> {
  return (await read()).docs;
}

export async function addDocument(title: string, text: string): Promise<KnowledgeDoc> {
  const store = await read();
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Nothing to store.");
  if (trimmed.length > MAX_DOCUMENT_CHARS) throw new Error("That document is too long - split it up.");

  const existingChars = store.docs.reduce((sum, d) => sum + d.chars, 0);
  if (existingChars + trimmed.length > MAX_TOTAL_CHARS) {
    throw new Error("The knowledge base is full - remove something first.");
  }

  const id = `doc_${Date.now()}_${Math.round(Math.random() * 1e6)}`;
  const pieces = chunkText(trimmed);
  const doc: KnowledgeDoc = {
    id,
    title: title.trim() || "Untitled",
    chars: trimmed.length,
    chunkCount: pieces.length,
    addedAt: new Date().toISOString(),
  };

  await setJSON(KV_KEY, {
    docs: [...store.docs, doc],
    chunks: [...store.chunks, ...pieces.map((text, index) => ({ docId: id, title: doc.title, index, text }))],
  } satisfies Store);

  return doc;
}

export async function removeDocument(id: string): Promise<void> {
  const store = await read();
  await setJSON(KV_KEY, {
    docs: store.docs.filter((d) => d.id !== id),
    chunks: store.chunks.filter((c) => c.docId !== id),
  } satisfies Store);
}
