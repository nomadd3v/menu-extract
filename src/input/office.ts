/**
 * Text extraction for Office document formats (DOCX, PPTX) and RTF.
 * Uses jszip (already a dependency) for DOCX/PPTX — no new packages needed.
 */

const MAX_TEXT_LENGTH = 40_000;

/**
 * Strip RTF control words and braces to extract plain text.
 * Good enough for real-world RTF menus; the model tolerates the remaining noise.
 */
export function stripRtf(rtf: string): string {
  return rtf
    .replace(/\{\\[\w\s*;]+\}/g, "")  // remove table/font/color groups
    .replace(/\\[a-z]+[-\d]* ?/gi, "") // remove control words like \par \b0 etc.
    .replace(/[{}\\]/g, "")            // remove remaining structural characters
    .replace(/\s{2,}/g, "\n")
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

/**
 * Extract plain text from a DOCX buffer using jszip.
 * Reads word/document.xml and strips XML tags.
 */
export async function extractDocxText(buffer: Buffer): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  const xmlFile = zip.file("word/document.xml");
  if (!xmlFile) return "";
  const xml = await xmlFile.async("string");
  return xml
    .replace(/<w:p[ >][^>]*>/gi, "\n") // paragraph start → newline
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/\s{2,}/g, "\n")
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

/**
 * Extract plain text from a PPTX buffer using jszip.
 * Reads each slide XML and strips tags.
 */
export async function extractPptxText(buffer: Buffer): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
    .sort();
  const parts: string[] = [];
  for (const name of slideNames) {
    const xml = await zip.files[name].async("string");
    const text = xml
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (text) parts.push(text);
  }
  return parts.join("\n\n").slice(0, MAX_TEXT_LENGTH);
}
