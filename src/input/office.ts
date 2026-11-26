/**
 * Plain-text extraction for DOCX, PPTX and RTF. DOCX and PPTX are zip archives of XML,
 * read with `jszip`; RTF is stripped of control words.
 *
 * @packageDocumentation
 */
import JSZip from "jszip";
import { MenuExtractError } from "../errors.js";
import { decodeEntities } from "./entities.js";

/** Remove XML tags (each becomes a space), decode entities and tidy whitespace. */
function xmlToText(xml: string): string {
  return decodeEntities(xml.replace(/<[^>]+>/g, " "))
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

async function openZip(buffer: Buffer): Promise<JSZip> {
  try {
    return await JSZip.loadAsync(buffer);
  } catch (cause) {
    throw new MenuExtractError(
      "UNREADABLE_INPUT",
      "Could not open the Office document (not a valid zip)",
      {
        cause,
      },
    );
  }
}

/** RTF groups that hold metadata rather than document text (one level of nesting). */
const RTF_DESTINATION_GROUP =
  /\{\\(?:\*|fonttbl|colortbl|stylesheet|info|pict)[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;

/**
 * Convert RTF to plain text: drop metadata groups and control words, turn `\par` and
 * `\line` into line breaks and decode `\'hh` escapes. Approximate by design; the model
 * tolerates what little noise remains.
 *
 * @param rtf - RTF source.
 * @returns Plain text, one line per paragraph.
 */
export function stripRtf(rtf: string): string {
  return rtf
    .replace(RTF_DESTINATION_GROUP, "")
    .replace(/\\(?:par|line)\b ?/g, "\n")
    .replace(/\\'([0-9a-f]{2})/gi, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replace(/\\[a-z]+-?\d* ?/gi, "")
    .replace(/[{}\\]/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Extract the text of a DOCX file, one paragraph per line.
 *
 * @param buffer - DOCX bytes.
 * @returns Plain text, or `""` if the archive has no `word/document.xml`.
 * @throws {@link MenuExtractError} `UNREADABLE_INPUT` if the bytes are not a zip archive.
 */
export async function extractDocxText(buffer: Buffer): Promise<string> {
  const zip = await openZip(buffer);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (xml === undefined) return "";
  return xmlToText(xml.replace(/<w:p[ >]/gi, "\n$&"));
}

/**
 * Extract the text of a PPTX file, slides in order, separated by a blank line.
 *
 * @param buffer - PPTX bytes.
 * @returns Plain text, or `""` if the archive has no slides.
 * @throws {@link MenuExtractError} `UNREADABLE_INPUT` if the bytes are not a zip archive.
 */
export async function extractPptxText(buffer: Buffer): Promise<string> {
  const zip = await openZip(buffer);
  const slideNumber = (path: string): number => Number(/(\d+)\.xml$/i.exec(path)?.[1] ?? 0);
  const slides = zip
    .file(/^ppt\/slides\/slide\d+\.xml$/i)
    .sort((a, b) => slideNumber(a.name) - slideNumber(b.name));
  const texts = await Promise.all(slides.map(async (s) => xmlToText(await s.async("string"))));
  return texts.filter(Boolean).join("\n\n");
}
