/**
 * Pulls plain text out of a file the athlete picked, in the browser.
 *
 * Done client-side on purpose: a book is tens of megabytes, and shipping it to
 * a serverless function to parse would mean a large upload, a parser dependency
 * in the function bundle, and a request that outlives the execution limit. Here
 * the file never leaves the machine until it is already text.
 *
 * PDFs are extracted page by page rather than in one pass so a long book can
 * report progress - a 400-page book takes long enough that a silent spinner
 * looks broken.
 */

export type ExtractProgress = (done: number, total: number, stage?: string) => void;

export type ExtractOptions = {
  onProgress?: ExtractProgress;
  /**
   * Send figure-heavy pages for description, so charts and tables become
   * searchable rather than being silently dropped. Costs one model call per
   * such page, which is why it is opt-in.
   */
  describeFigures?: boolean;
};

// A page with barely any extractable text is almost always a figure, a table
// rendered as an image, or a scan. Above this it is prose with a picture in it,
// and the prose is the part worth having.
const FIGURE_TEXT_THRESHOLD = 220;
// Caps the spend and the wait on a long book. Beyond this the figures are
// usually decorative anyway.
const MAX_FIGURES = 40;

export async function extractDocumentText(file: File, options: ExtractOptions = {}): Promise<string> {
  const name = file.name.toLowerCase();
  const onProgress = options.onProgress;

  if (name.endsWith(".pdf")) return extractPdf(file, options);
  if (name.endsWith(".epub")) return extractEpub(file, onProgress);
  if (/\.(txt|md|markdown|csv)$/.test(name)) return file.text();

  throw new Error("Unsupported file. Use a PDF, EPUB, or a text file (.txt / .md).");
}

async function extractPdf(file: File, options: ExtractOptions): Promise<string> {
  const onProgress = options.onProgress;
  // Imported lazily so the PDF engine is only downloaded when someone actually
  // picks a PDF - it is far larger than the rest of the settings page.
  const pdfjs = await import("pdfjs-dist");
  // The worker has to be pointed at explicitly under Vite; without this the
  // library tries to fetch a path that does not exist in the build output.
  pdfjs.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;

  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: string[] = [];
  const figurePages: number[] = [];

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    // Items carry their own positions; joining on spaces and letting the
    // paragraph reflow below sort it out beats trying to reconstruct layout.
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) pages.push(text);
    // A page with barely any extractable text is a figure, a table rendered as
    // an image, or a scan - exactly the pages text extraction loses.
    if (options.describeFigures && text.length < FIGURE_TEXT_THRESHOLD) figurePages.push(pageNumber);
    onProgress?.(pageNumber, doc.numPages, "Reading");
  }

  if (options.describeFigures && figurePages.length > 0) {
    const targets = figurePages.slice(0, MAX_FIGURES);
    for (let i = 0; i < targets.length; i++) {
      const described = await describePage(doc as unknown as PdfDocument, targets[i]);
      // Labelled with its page so a hit can be traced back to the book.
      if (described) pages.push(`Figure on page ${targets[i]}: ${described}`);
      onProgress?.(i + 1, targets.length, "Describing figures");
    }
  }

  return reflow(pages.join("\n\n"));
}

/**
 * Renders one page and asks the server to describe it.
 *
 * Rendered at a modest width: enough for axis labels and table values to be
 * legible, small enough that the upload stays sane on a phone connection.
 */
async function describePage(doc: PdfDocument, pageNumber: number): Promise<string> {
  try {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const scale = Math.min(2, 1400 / viewport.width);
    const scaled = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(scaled.width);
    canvas.height = Math.floor(scaled.height);
    const context = canvas.getContext("2d");
    if (!context) return "";
    await page.render({ canvas, canvasContext: context, viewport: scaled } as never).promise;

    const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
    const res = await fetch("/api/describe-figure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64: dataUrl.split(",")[1], mediaType: "image/jpeg" }),
    });
    if (!res.ok) return "";
    const body = (await res.json()) as { text?: string };
    return body.text ?? "";
  } catch {
    // One unreadable page must not abandon the whole book.
    return "";
  }
}

/**
 * Structurally what this needs from pdf.js, rather than importing its types.
 * The library's own RenderParameters is stricter than the call made here and
 * changes shape between majors; this keeps the dependency at arm's length.
 */
type PdfDocument = {
  numPages: number;
  getPage: (n: number) => Promise<{
    getViewport: (options: { scale: number }) => { width: number; height: number };
    render: (options: never) => { promise: Promise<void> };
  }>;
};

async function extractEpub(file: File, onProgress?: ExtractProgress): Promise<string> {
  // An EPUB is a zip of XHTML. Unpacked with the browser's own decompression
  // rather than a zip library - one less dependency for a format that is
  // already just deflate.
  const { unzipSync } = await import("fflate");
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const names = Object.keys(entries)
    .filter((n) => /\.(x?html)$/i.test(n))
    .sort();

  const decoder = new TextDecoder();
  const parser = new DOMParser();
  const parts: string[] = [];

  names.forEach((name, i) => {
    const html = decoder.decode(entries[name]);
    const body = parser.parseFromString(html, "application/xhtml+xml").body;
    const text = body?.textContent?.replace(/\s+/g, " ").trim();
    if (text) parts.push(text);
    onProgress?.(i + 1, names.length);
  });

  return reflow(parts.join("\n\n"));
}

/**
 * Extraction produces one long line per page or chapter. Splitting it back into
 * paragraphs matters because the chunker works on blank lines - without this a
 * whole chapter is one paragraph and gets hard-split mid-sentence.
 */
function reflow(text: string): string {
  return text
    .replace(/\s+/g, " ")
    // A sentence end followed by a capital is the most reliable paragraph
    // signal left once layout is gone.
    .replace(/([.!?])\s+(?=[A-Z"“'])/g, "$1\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
