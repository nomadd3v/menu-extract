/**
 * HTML to plain text. Regex-based on purpose: menus need readable text for the model,
 * not a faithful DOM, and this keeps the library free of a parser dependency.
 *
 * @packageDocumentation
 */
import { decodeEntities } from "./entities.js";

/**
 * Read the page title, keeping only the part before a separator such as `|`, `-` or `—`
 * (so `"Example Pizza | Menu"` becomes `"Example Pizza"`). Used as a restaurant-name hint.
 *
 * @param html - An HTML document.
 * @returns The title, or `null` if there is no non-empty `<title>`.
 */
export function extractPageTitle(html: string): string | null {
  const match = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  const title = decodeEntities(match?.[1] ?? "").trim();
  if (!title) return null;
  const lead = title.split(/\s*[|\-–—]\s*/)[0]?.trim();
  return lead || title;
}

/**
 * Strip scripts, styles and tags, decode entities, and collapse runs of whitespace into
 * line breaks so the model still sees one line per menu entry.
 *
 * @param html - An HTML document or fragment.
 * @returns Plain text.
 */
export function htmlToText(html: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(stripped)
    .replace(/\s{2,}/g, "\n")
    .trim();
}
