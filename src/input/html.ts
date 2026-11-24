const MAX_TEXT_LENGTH = 40_000;

/**
 * Extract the browser tab title from an HTML string.
 * Strips common " | suffix" / " - suffix" / " — suffix" boilerplate that
 * appears after the restaurant name (e.g. "Example Pizza | Menu" → "Example Pizza").
 * Returns null if no <title> tag is found.
 */
export function extractPageTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (!m) return null;
  const raw = m[1]
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
  if (!raw) return null;
  // Strip trailing section after first separator (keep the leading restaurant name part)
  const trimmed = raw.split(/\s*[|\-–—]\s*/)[0].trim();
  return trimmed || raw;
}

/**
 * Strip HTML tags, scripts, styles and decode common entities.
 * Returns plain text capped at 40KB.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, "\n")
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

/**
 * Extract image URLs from HTML. Returns favicons first (highest priority),
 * then img srcs, srcsets, and CSS background-image URLs.
 */
export function extractImageUrls(html: string, baseUrl: string): string[] {
  const favicons = new Set<string>();
  const images = new Set<string>();
  let m: RegExpExecArray | null;

  // Favicons — rel="icon", rel="shortcut icon", rel="apple-touch-icon"
  const linkRe = /<link([^>]+)>/gi;
  while ((m = linkRe.exec(html)) !== null) {
    const attrs = m[1];
    if (/rel=["'][^"']*(?:icon|apple-touch-icon)[^"']*["']/i.test(attrs)) {
      const href = attrs.match(/href=["']([^"']+)["']/i);
      if (href) {
        try {
          favicons.add(new URL(href[1], baseUrl).href);
        } catch {
          /* invalid URL */
        }
      }
    }
  }

  // Also try /favicon.ico at root as fallback
  try {
    const root = new URL(baseUrl);
    favicons.add(`${root.protocol}//${root.host}/favicon.ico`);
  } catch {
    /* invalid base URL */
  }

  // <img> tags — src plus common lazy-load data attributes
  const imgTagRe = /<img([^>]+)>/gi;
  const lazyAttrRe =
    /(?:^|\s)(?:src|data-src|data-lazy-src|data-lazy|data-original|data-img|data-url)=["']([^"']+)["']/gi;
  while ((m = imgTagRe.exec(html)) !== null) {
    const tag = m[1];
    let a: RegExpExecArray | null;
    lazyAttrRe.lastIndex = 0;
    while ((a = lazyAttrRe.exec(tag)) !== null) {
      const val = a[1].trim().split(/\s+/)[0];
      if (val && !val.startsWith("data:")) {
        try {
          images.add(new URL(val, baseUrl).href);
        } catch {
          /* invalid URL */
        }
      }
    }
  }

  // srcset / data-srcset anywhere
  const srcsetRe = /data-srcset=["']([^"']+)["']|srcset=["']([^"']+)["']/gi;
  while ((m = srcsetRe.exec(html)) !== null) {
    const raw = (m[1] || m[2] || "").trim().split(",")[0].trim().split(/\s+/)[0];
    if (raw) {
      try {
        images.add(new URL(raw, baseUrl).href);
      } catch {
        /* invalid URL */
      }
    }
  }

  // CSS background-image inline styles
  const bgRe = /url\(["']?(https?:\/\/[^"')]+)["']?\)/gi;
  while ((m = bgRe.exec(html)) !== null) {
    try {
      images.add(new URL(m[1], baseUrl).href);
    } catch {
      /* invalid URL */
    }
  }

  // Favicons first, then the rest
  return [...favicons, ...images];
}
