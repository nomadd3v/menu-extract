const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/**
 * Decode the HTML/XML entities that appear in menu text: the common named ones
 * (`&amp;`, `&nbsp;`, ...) and numeric references (`&#39;`, `&#x2014;`).
 * Unknown named entities are left as they are. Decoding is single-pass, so
 * `&amp;lt;` becomes `&lt;`, not `<`.
 *
 * @param input - Text containing entities.
 * @returns The decoded text.
 */
export function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith("#")) {
      const hex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}
