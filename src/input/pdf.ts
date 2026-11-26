/**
 * PDF text extraction and page rendering via the optional peer `mupdf` (AGPL-3.0).
 * `mupdf` is loaded lazily, only when a PDF is actually processed.
 *
 * @packageDocumentation
 */
import { MenuExtractError } from "../errors.js";

type Mupdf = typeof import("mupdf");
type PdfDocument = InstanceType<Mupdf["Document"]>;

/** Pages are rendered at 150 dpi: legible for the model, small enough to keep token cost down. */
const RENDER_SCALE = 150 / 72;
const JPEG_QUALITY = 82;

let mupdfPromise: Promise<Mupdf> | undefined;

function loadMupdf(): Promise<Mupdf> {
  mupdfPromise ??= import("mupdf").catch((cause: unknown) => {
    mupdfPromise = undefined;
    throw new MenuExtractError(
      "MISSING_DEPENDENCY",
      'PDF input needs the optional peer dependency "mupdf" (AGPL-3.0): npm install mupdf',
      { cause },
    );
  });
  return mupdfPromise;
}

async function openPdf(buffer: Buffer): Promise<{ mupdf: Mupdf; doc: PdfDocument }> {
  const mupdf = await loadMupdf();
  try {
    return { mupdf, doc: mupdf.Document.openDocument(buffer, "application/pdf") };
  } catch (cause) {
    throw new MenuExtractError("UNREADABLE_INPUT", "Could not open the PDF", { cause });
  }
}

/** Text of a PDF, page by page. */
export interface PdfText {
  /** All page texts joined by a blank line. */
  text: string;
  /** Total number of pages in the document. */
  pageCount: number;
  /** Zero-based indexes of pages whose text could not be read. */
  failedPages: number[];
}

/**
 * Extract the text layer of every page.
 *
 * @param buffer - PDF bytes.
 * @throws {@link MenuExtractError} `MISSING_DEPENDENCY` without `mupdf`, `UNREADABLE_INPUT`
 *   when the bytes are not a readable PDF.
 */
export async function extractPdfText(buffer: Buffer): Promise<PdfText> {
  const { doc } = await openPdf(buffer);
  const pageCount = doc.countPages();
  const texts: string[] = [];
  const failedPages: number[] = [];
  for (let i = 0; i < pageCount; i++) {
    try {
      texts.push(doc.loadPage(i).toStructuredText("preserve-whitespace").asText().trim());
    } catch {
      failedPages.push(i);
    }
  }
  return { text: texts.filter(Boolean).join("\n\n"), pageCount, failedPages };
}

/** A PDF page rendered to an image. */
export interface RenderedPage {
  /** Zero-based page index. */
  index: number;
  mediaType: "image/jpeg";
  /** JPEG bytes as base64 without a `data:` prefix. */
  base64: string;
}

/** Rendered pages of a PDF. */
export interface PdfRender {
  pages: RenderedPage[];
  /** Total number of pages in the document (may exceed the number rendered). */
  pageCount: number;
  /** Zero-based indexes of pages that failed to render. */
  failedPages: number[];
}

/**
 * Render pages to JPEG, for scanned PDFs that have no usable text layer.
 *
 * @param buffer - PDF bytes.
 * @param maxPages - Render at most this many pages, from the first.
 * @throws {@link MenuExtractError} `MISSING_DEPENDENCY` without `mupdf`, `UNREADABLE_INPUT`
 *   when the bytes are not a readable PDF.
 */
export async function renderPdfPages(buffer: Buffer, maxPages: number): Promise<PdfRender> {
  const { mupdf, doc } = await openPdf(buffer);
  const pageCount = doc.countPages();
  const matrix = mupdf.Matrix.scale(RENDER_SCALE, RENDER_SCALE);
  const pages: RenderedPage[] = [];
  const failedPages: number[] = [];
  for (let i = 0; i < Math.min(pageCount, maxPages); i++) {
    try {
      const pixmap = doc.loadPage(i).toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true);
      const base64 = Buffer.from(pixmap.asJPEG(JPEG_QUALITY)).toString("base64");
      pages.push({ index: i, mediaType: "image/jpeg", base64 });
    } catch {
      failedPages.push(i);
    }
  }
  return { pages, pageCount, failedPages };
}
